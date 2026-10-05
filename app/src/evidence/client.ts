/**
 * Talks to `evidence-service`. Bytes out, receipts back.
 *
 * No React Native imports, so `scripts/` can exercise it under plain Node —
 * the same discipline as `api/client.ts` and `stt/client.ts`.
 */

import { authHeaders } from "../api/auth";
import { siblingUrl } from "../api/url";

const EVIDENCE_PORT = 8789;
const TIMEOUT_MS = { chunk: 25_000, meta: 8_000 } as const;

export interface ChunkReceipt {
  seq: number;
  /** The service's clock at receipt. The device does not get a say. */
  receivedAt: string;
  /** SHA-256 computed over the bytes as they arrived. */
  sha256: string;
  bytes: number;
  duplicate: boolean;
}

export interface EvidenceManifest {
  sessionId: string;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  chunks: Array<{
    seq: number;
    receivedAt: string;
    capturedAt: string | null;
    sha256: string;
    bytes: number;
    mime: string;
    latitude: number | null;
    longitude: number | null;
  }>;
  totalBytes: number;
}

/** One position fix as the service recorded it (PRD R4, R8). */
export interface TrailFix {
  seq: number;
  /** Server receipt time. The device does not get to choose this. */
  at: string;
  latitude: number;
  longitude: number;
}

export interface EvidenceHealth {
  ok: boolean;
  sessions: number;
  retentionDays: number;
  maxSessionMb: number;
}

export class EvidenceError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "timeout" | "http" | "malformed",
    readonly status?: number,
  ) {
    super(message);
    this.name = "EvidenceError";
  }
}

/** Same deployment as the engine: a sibling port in dev, a sibling path behind a proxy. */
export function defaultEvidenceUrl(engineBaseUrl: string): string {
  return siblingUrl(engineBaseUrl, { port: EVIDENCE_PORT, segment: "evidence" });
}

async function req(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    throw new EvidenceError(
      aborted ? "Evidence upload timed out." : "Could not reach the evidence service.",
      aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface ChunkMeta {
  capturedAt: string;
  mime: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Upload one chunk and wait for the acknowledgement.
 *
 * PRD R4 wants the chunk "uploaded and acknowledged before the next begins".
 * The caller treats a rejected promise as "still owed" and keeps the chunk
 * queued — losing evidence to an optimistic delete is the failure this whole
 * service exists to prevent.
 */
export async function uploadChunk(
  baseUrl: string,
  sessionId: string,
  seq: number,
  body: Uint8Array,
  meta: ChunkMeta,
  token: string | null,
): Promise<ChunkReceipt> {
  const params = new URLSearchParams({ seq: String(seq), capturedAt: meta.capturedAt });
  if (meta.latitude !== null) params.set("lat", String(meta.latitude));
  if (meta.longitude !== null) params.set("lon", String(meta.longitude));

  const res = await req(
    `${baseUrl}/session/${encodeURIComponent(sessionId)}/chunk?${params.toString()}`,
    {
      method: "POST",
      headers: { "content-type": meta.mime, ...authHeaders(token) },
      // A copy, because the underlying buffer may be a view into a larger one.
      body: body.slice().buffer as ArrayBuffer,
    },
    TIMEOUT_MS.chunk,
  );

  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      /* raw text is the best detail available */
    }
    throw new EvidenceError(`Evidence service returned ${res.status}: ${detail}`, "http", res.status);
  }

  try {
    return JSON.parse(text) as ChunkReceipt;
  } catch {
    throw new EvidenceError("Evidence service returned an unreadable receipt.", "malformed");
  }
}

/** Sequence numbers already held, so a phone that restarted knows what it owes. */
export async function getAcknowledged(baseUrl: string, sessionId: string, token: string | null): Promise<number[]> {
  const res = await req(
    `${baseUrl}/session/${encodeURIComponent(sessionId)}/acks`,
    { method: "GET", headers: authHeaders(token) },
    TIMEOUT_MS.meta,
  );
  if (!res.ok) throw new EvidenceError(`Evidence service returned ${res.status}.`, "http", res.status);
  const body = (await res.json()) as { seqs?: number[] };
  return Array.isArray(body.seqs) ? body.seqs : [];
}

export async function getManifest(baseUrl: string, sessionId: string, token: string | null): Promise<EvidenceManifest | null> {
  const res = await req(
    `${baseUrl}/session/${encodeURIComponent(sessionId)}/manifest`,
    { method: "GET", headers: authHeaders(token) },
    TIMEOUT_MS.meta,
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new EvidenceError(`Evidence service returned ${res.status}.`, "http", res.status);
  return (await res.json()) as EvidenceManifest;
}

/**
 * The location trail (PRD R8).
 *
 * Derived by the service from the same manifest as the audio, so a fix cannot
 * outlive the recording it was taken with, and one DELETE removes both.
 */
export async function getTrail(baseUrl: string, sessionId: string, token: string | null): Promise<TrailFix[]> {
  const res = await req(
    `${baseUrl}/session/${encodeURIComponent(sessionId)}/trail`,
    { method: "GET", headers: authHeaders(token) },
    TIMEOUT_MS.meta,
  );
  if (res.status === 404) return [];
  if (!res.ok) throw new EvidenceError(`Evidence service returned ${res.status}.`, "http", res.status);
  const body = (await res.json()) as { fixes?: TrailFix[] };
  return Array.isArray(body.fixes) ? body.fixes : [];
}

export async function getEvidenceHealth(baseUrl: string): Promise<EvidenceHealth> {
  const res = await req(`${baseUrl}/health`, { method: "GET" }, TIMEOUT_MS.meta);
  if (!res.ok) throw new EvidenceError(`Evidence service returned ${res.status}.`, "http", res.status);
  return (await res.json()) as EvidenceHealth;
}

/** PRD R4 — permanent deletion of the audio, not just the transcript. */
export async function deleteEvidence(baseUrl: string, sessionId: string, token: string | null): Promise<void> {
  const res = await req(
    `${baseUrl}/session/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: authHeaders(token) },
    TIMEOUT_MS.meta,
  );
  if (!res.ok) throw new EvidenceError(`Evidence service returned ${res.status}.`, "http", res.status);
}
