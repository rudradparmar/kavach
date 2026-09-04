import http from "node:http";
import { EvidenceStore } from "./store.js";
import { describeAuth, loadAuthConfig, requireSession } from "../../shared/auth.js";
import { installShutdown, startRetentionSweep } from "../../shared/lifecycle.js";
import { clientKey, createRateLimiter } from "../../shared/ratelimit.js";

/**
 * Kavach evidence service (PRD R4).
 *
 * POST   /session/:id/chunk?seq=N   raw audio bytes -> { seq, receivedAt, sha256 }
 * GET    /session/:id/manifest      what is held, with hashes and receipt times
 * GET    /session/:id/acks          sequence numbers already stored, for resume
 * GET    /session/:id/chunk/:seq    the bytes back, playable
 * DELETE /session/:id               permanent deletion
 * GET    /health
 *
 * Separate from the engine for the same reason `stt-service` is: an advocate
 * reading `kavach-engine/` should find corpus, deterministic rules and the
 * guard, and nothing else. This service reads no corpus and authors no legal
 * claim — it takes bytes, timestamps them, hashes them and keeps them.
 *
 * It is also the piece the PRD's unanswered question bites hardest:
 * "where does evidence live, under whose jurisdiction, and who can be
 * compelled to produce it?" Keeping it a separate, separately deployable
 * service is what leaves that answerable later.
 */

const store = new EvidenceStore();
const auth = loadAuthConfig();

/** One chunk is ~10s of 64kbps audio, about 80KB. 8MB is a wide margin. */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
} as const;

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  const s = JSON.stringify(body);
  res.writeHead(code, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(s),
    ...CORS,
  });
  res.end(s);
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_CHUNK_BYTES) {
        reject(new Error(`chunk exceeds ${Math.round(MAX_CHUNK_BYTES / 1024 / 1024)}MB`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

const num = (v: string | null): number | null => {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};


/**
 * Slows down guessing at session ids and the instance key.
 *
 * Consulted only after authorisation has already failed, so a valid capability
 * is never refused. Users behind carrier-grade NAT share an address with
 * thousands of strangers, and a phone that cannot hand over its audio is the
 * failure this whole service exists to prevent.
 */
const authLimiter = createRateLimiter({ capacity: 20, refillPerMinute: 10 });

/** Call after the auth check fails. True when the response is finished. */
function chargeFailure(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const verdict = authLimiter.take(clientKey(req));
  if (verdict.allowed) return false;
  res.writeHead(429, {
    ...CORS,
    "content-type": "application/json",
    "retry-after": String(verdict.retryAfterSeconds),
  });
  res.end(JSON.stringify({ error: "too many requests" }));
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/health") {
      const sessions = store.listSessions();
      return json(res, 200, {
        ok: true,
        sessions: sessions.length,
        retentionDays: store.retentionDays,
        maxSessionMb: Math.round(store.maxSessionBytes / 1024 / 1024),
      });
    }

    if (parts[0] === "session" && parts[1]) {
      const sessionId = parts[1];

      // Every route here touches the audio of one encounter, so every route
      // needs a capability for that encounter. The token is minted by the
      // engine and verified with a shared secret — this service never has to
      // know the engine exists.
      const denied = requireSession(auth, req, sessionId);
      if (denied) {
        if (chargeFailure(req, res)) return;
        return json(res, denied.status, { error: denied.error });
      }

      if (req.method === "POST" && parts[2] === "chunk") {
        const seq = num(url.searchParams.get("seq"));
        if (seq === null) return json(res, 400, { error: "seq required" });

        const body = await readBody(req);
        const result = store.accept({
          sessionId,
          seq,
          body,
          mime: (req.headers["content-type"] ?? "audio/m4a").split(";")[0] ?? "audio/m4a",
          capturedAt: url.searchParams.get("capturedAt"),
          latitude: num(url.searchParams.get("lat")),
          longitude: num(url.searchParams.get("lon")),
        });

        if (!result.ok) return json(res, result.status, { error: result.error });
        // 200 for a duplicate, 201 for something new — a retrying client can
        // tell the difference without having to compare manifests.
        return json(res, result.duplicate ? 200 : 201, {
          ...result.chunk,
          duplicate: result.duplicate,
        });
      }

      if (req.method === "GET" && parts[2] === "manifest") {
        const m = store.readManifest(sessionId);
        if (!m) return json(res, 404, { error: "no evidence for this session" });
        return json(res, 200, m);
      }

      if (req.method === "GET" && parts[2] === "acks") {
        return json(res, 200, { sessionId, seqs: store.acknowledgedSeqs(sessionId) });
      }

      if (req.method === "GET" && parts[2] === "chunk" && parts[3]) {
        const seq = num(parts[3]);
        if (seq === null) return json(res, 400, { error: "bad seq" });
        const got = store.readChunk(sessionId, seq);
        if (!got) return json(res, 404, { error: "no such chunk" });
        res.writeHead(200, {
          "content-type": got.mime,
          "content-length": got.body.byteLength,
          ...CORS,
        });
        return res.end(got.body);
      }

      if (req.method === "DELETE" && !parts[2]) {
        const removed = store.remove(sessionId);
        return json(res, 200, { deleted: true, hadEvidence: removed });
      }
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
});

const PORT = Number(process.env.PORT ?? 8789);

// Sweeps now and then on a timer. It used to sweep only at boot, so a
// long-running deployment held every chunk of audio ever uploaded, past the
// stated 30 days, while still telling users retention was bounded.
const sweeper = startRetentionSweep({
  label: "evidence store",
  sweep: () => store.sweep(),
  log: (m) => console.log(m),
});

server.listen(PORT, () => {
  console.log(`kavach-evidence on :${PORT}`);
  console.log(describeAuth(auth));
  console.log(
    `  ${store.listSessions().length} session(s) held in ${store.dir} · kept ${store.retentionDays} days · ${Math.round(store.maxSessionBytes / 1024 / 1024)}MB per session · swept every ${sweeper.intervalMinutes}m`,
  );
  if (sweeper.sweptAtBoot > 0) console.log(`  swept ${sweeper.sweptAtBoot} session(s) past retention at boot`);
  console.log("\n  !! This directory holds audio of encounters with police. Treat it accordingly.\n");
});

// A chunk the phone believes was acknowledged is a chunk the phone deletes,
// so a redeploy must not drop one mid-write.
installShutdown({ label: "kavach-evidence", server, onStop: () => sweeper.stop() });
