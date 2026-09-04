import http from "node:http";
import { MockProvider } from "./mock.js";
import { OpenAiCompatibleProvider, ROMANISATION_PROMPT } from "./openaiCompatible.js";
import type { TranscriptionProvider } from "./provider.js";
import { bearer, describeAuth, loadAuthConfig, requireApiKey, verifySessionToken } from "../../shared/auth.js";
import { installShutdown } from "../../shared/lifecycle.js";

/**
 * Kavach speech-to-text service.
 *
 * POST /transcribe   raw audio bytes in the body -> { text, script, ... }
 * GET  /health       provider, model, whether it is simulated
 *
 * The body is raw audio rather than multipart because both ends of this wire
 * are ours, and a hand-rolled multipart parser is a pointless place to spend
 * correctness. The outbound call to the provider is multipart, built with the
 * platform FormData.
 */

/** A phone recording a roadside encounter, not a podcast. 25 MB is generous. */
const MAX_BYTES = 25 * 1024 * 1024;

function makeProvider(): TranscriptionProvider {
  const kind = process.env.KAVACH_STT_PROVIDER ?? "mock";

  if (kind === "openai-compatible") {
    const url = process.env.KAVACH_STT_URL;
    const key = process.env.KAVACH_STT_KEY ?? "";
    const model = process.env.KAVACH_STT_MODEL ?? "whisper-1";
    if (!url) throw new Error("KAVACH_STT_PROVIDER=openai-compatible requires KAVACH_STT_URL");
    return new OpenAiCompatibleProvider(url, key, model);
  }

  if (kind !== "mock") {
    throw new Error(`Unknown KAVACH_STT_PROVIDER "${kind}". Use "mock" or "openai-compatible".`);
  }
  return new MockProvider();
}

const provider = makeProvider();
const auth = loadAuthConfig();

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(s),
    // The Expo client is native and does not need this, but `expo start --web`
    // does, and a browser tab is the cheapest way to debug a recording.
    "access-control-allow-origin": "*",
  });
  res.end(s);
};

const readAudio = (req: http.IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BYTES) {
        reject(new Error(`Audio exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB.`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        provider: provider.name,
        model: provider.model,
        simulated: provider.simulated,
      });
    }

    if (req.method === "POST" && url.pathname === "/transcribe") {
      // Audio of an encounter is being handed over, so a caller needs either a
      // session capability or the instance key. There is no session id in this
      // path, so any valid unexpired session token is accepted — the token
      // still proves the caller started a session on this deployment.
      if (auth.enabled) {
        const token = bearer(req);
        if (!token) return json(res, 401, { error: "missing bearer token" });
        const asSession = verifySessionToken(auth, token);
        if (!asSession.ok && requireApiKey(auth, req)) {
          return json(res, 403, { error: "not a valid token for this deployment" });
        }
      }
      const audio = await readAudio(req);
      if (audio.byteLength === 0) return json(res, 400, { error: "empty audio body" });

      const contentType = req.headers["content-type"] ?? "audio/m4a";
      const language = url.searchParams.get("language");
      // The client may opt out of the romanisation bias; default is on,
      // because without it Hindi transcripts miss every classifier cue.
      const romanise = url.searchParams.get("romanise") !== "false";

      const started = Date.now();
      const result = await provider.transcribe({
        audio,
        contentType,
        filename: url.searchParams.get("filename") ?? "turn.m4a",
        language,
        prompt: romanise ? ROMANISATION_PROMPT : null,
      });

      return json(res, 200, {
        ...result,
        bytes: audio.byteLength,
        totalMs: Date.now() - started,
        /**
         * Set when the transcript is in a script the engine's classifier cues
         * do not cover. Not an error — the transcript is still correct — but
         * the guidance downstream will fall back, and the user deserves to
         * know that is why rather than thinking the product is broken.
         */
        classifierScriptMismatch: result.script === "devanagari",
      });
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
});

const PORT = Number(process.env.PORT ?? 8788);
server.listen(PORT, () => {
  console.log(`kavach-stt on :${PORT}  provider=${provider.name}  model=${provider.model ?? "-"}`);
  console.log(describeAuth(auth));
  if (provider.simulated) {
    console.log("\n  !! SIMULATED PROVIDER — audio is NOT transcribed. Canned text only.\n");
  }
});

// Nothing to sweep -- this service stores nothing. It still needs to let an
// in-flight transcription finish rather than dropping it on a redeploy.
installShutdown({ label: "kavach-stt", server });
