import { authHeaders } from "../api/auth";
import type { Recording, SttHealth, Transcript } from "./types";

/**
 * Talks to stt-service. Uploads audio, gets words back.
 *
 * It is a separate address from the engine because it is a separate service:
 * the engine is the corpus-grounded legal core, and a speech model has no
 * business inside it. In development both usually run on the same host, so
 * the default derives the STT port from whatever the engine address is.
 */

const STT_PORT = 8788;
const TIMEOUT_MS = 30_000;

export class SttError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "timeout" | "http" | "malformed",
  ) {
    super(message);
    this.name = "SttError";
  }
}

/** Same host as the engine, different port. */
export function defaultSttUrl(engineBaseUrl: string): string {
  try {
    const u = new URL(engineBaseUrl);
    return `${u.protocol}//${u.hostname}:${STT_PORT}`;
  } catch {
    return `http://localhost:${STT_PORT}`;
  }
}

export async function getSttHealth(baseUrl: string): Promise<SttHealth> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    if (!res.ok) throw new SttError(`Transcription service returned ${res.status}.`, "http");
    return (await res.json()) as SttHealth;
  } catch (e) {
    if (e instanceof SttError) throw e;
    const aborted = (e as Error)?.name === "AbortError";
    throw new SttError(
      aborted ? "Transcription service did not respond." : `Could not reach transcription at ${baseUrl}.`,
      aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Uploads a recording and returns what was heard.
 *
 * The file is sent as raw bytes rather than multipart because both ends are
 * ours and multipart buys nothing here. React Native can read the recording
 * off the local file URI with fetch, which avoids pulling the whole thing
 * through JS as a base64 string.
 */
export async function transcribe(
  baseUrl: string,
  recording: Recording,
  language: string | null,
  token: string | null,
): Promise<Transcript> {
  let blob: Blob;
  try {
    const fileRes = await fetch(recording.uri);
    blob = await fileRes.blob();
  } catch {
    throw new SttError("Could not read the recording off the device.", "malformed");
  }

  if (blob.size === 0) {
    throw new SttError("The recording was empty — nothing was captured.", "malformed");
  }

  const params = new URLSearchParams({ filename: "turn.m4a" });
  if (language) params.set("language", language);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/transcribe?${params.toString()}`, {
      method: "POST",
      headers: { "content-type": recording.contentType, ...authHeaders(token) },
      body: blob,
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    throw new SttError(
      aborted ? "Transcription took too long." : `Could not reach transcription at ${baseUrl}.`,
      aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();
  if (!res.ok) {
    let detail = body.slice(0, 200);
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // Raw text is the best detail available.
    }
    throw new SttError(`Transcription failed: ${detail}`, "http");
  }

  try {
    return JSON.parse(body) as Transcript;
  } catch {
    throw new SttError("Transcription returned a response this client could not parse.", "malformed");
  }
}
