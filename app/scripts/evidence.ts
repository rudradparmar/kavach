/**
 * Drives the evidence custody chain against a running evidence-service, using
 * the app's own client module (src/evidence/client.ts).
 *
 *   cd evidence-service && npm run dev     # :8789
 *   cd app && npm run evidence
 *
 * The device half — rotation, AES-GCM encryption, the on-disk queue — needs a
 * phone and is not covered here. What this proves is the part a lawyer would
 * lean on: that a chunk uploaded is a chunk stored, hashed at receipt, timed
 * by the server, playable back byte-for-byte, and gone when deleted.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  deleteEvidence,
  getAcknowledged,
  getEvidenceHealth,
  getManifest,
  uploadChunk,
} from "../src/evidence/client";
import { apiKey } from "./creds";

// The instance key opens any session — the operations escape hatch, which is
// what a check script legitimately is. scripts/auth.ts covers the per-session
// capability path.
const KEY = apiKey();

const BASE = process.argv[2] ?? "http://localhost:8789";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? green("✓") : red("✗")} ${label}${detail ? dim(`  ${detail}`) : ""}`);
  if (!ok) failures += 1;
};

/** Stands in for ~10s of m4a. Content differs per chunk so hashes must differ. */
const fakeChunk = (seq: number, size = 4096) => new Uint8Array(size).fill((seq % 250) + 1);

async function main() {
  const health = await getEvidenceHealth(BASE);
  console.log(
    `\n${bold("evidence")}  ${BASE}  ${health.sessions} session(s) held · kept ${health.retentionDays} days · ${health.maxSessionMb}MB cap\n`,
  );

  const sessionId = randomUUID();
  console.log(dim(`session ${sessionId}`));

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("1. receipt")}`);

  const bodies = [0, 1, 2].map((i) => fakeChunk(i));
  const receipts = [];
  for (const [seq, body] of bodies.entries()) {
    receipts.push(
      await uploadChunk(BASE, sessionId, seq, body, {
        capturedAt: new Date().toISOString(),
        mime: "audio/m4a",
        latitude: 28.6139,
        longitude: 77.209,
      }, KEY),
    );
  }

  check("every chunk was acknowledged", receipts.length === 3);
  check(
    "each hash matches the bytes that were sent",
    receipts.every((r, i) => r.sha256 === createHash("sha256").update(bodies[i]!).digest("hex")),
  );
  check("hashes are distinct across chunks", new Set(receipts.map((r) => r.sha256)).size === 3);
  check(
    "receipt timestamps are real and server-side",
    receipts.every((r) => Date.parse(r.receivedAt) > Date.parse("2020-01-01")),
    receipts[0]?.receivedAt,
  );

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("2. resilience")}`);

  // A client that uploaded but lost the acknowledgement retries. Ten seconds
  // of an encounter must not end up stored twice.
  const retry = await uploadChunk(BASE, sessionId, 1, bodies[1]!, {
    capturedAt: new Date().toISOString(),
    mime: "audio/m4a",
    latitude: null,
    longitude: null,
  }, KEY);
  check("a re-upload is recognised as a duplicate, not stored again", retry.duplicate);
  check("the duplicate returns the original receipt", retry.sha256 === receipts[1]?.sha256);

  const acks = await getAcknowledged(BASE, sessionId, KEY);
  check("acknowledged sequences are reportable for resume", JSON.stringify(acks) === "[0,1,2]", JSON.stringify(acks));

  const manifest = await getManifest(BASE, sessionId, KEY);
  check("the manifest lists exactly what was sent", manifest?.chunks.length === 3);
  check(
    "total bytes add up",
    manifest?.totalBytes === bodies.reduce((n, b) => n + b.byteLength, 0),
    String(manifest?.totalBytes),
  );

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("3. playable back")}`);

  const auth: Record<string, string> = KEY ? { authorization: `Bearer ${KEY}` } : {};
  const res = await fetch(`${BASE}/session/${sessionId}/chunk/0`, { headers: auth });
  const back = new Uint8Array(await res.arrayBuffer());
  check("a stored chunk comes back byte-identical", Buffer.from(back).equals(Buffer.from(bodies[0]!)));
  check("it is served with an audio content type", (res.headers.get("content-type") ?? "").startsWith("audio/"));

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("4. deletion (PRD R4)")}`);

  await deleteEvidence(BASE, sessionId, KEY);
  check("the manifest is gone", (await getManifest(BASE, sessionId, KEY)) === null);
  check(
    "the audio is gone",
    (await fetch(`${BASE}/session/${sessionId}/chunk/0`, { headers: auth })).status === 404,
  );
  check("nothing is acknowledged any more", (await getAcknowledged(BASE, sessionId, KEY)).length === 0);

  console.log(`\n${failures === 0 ? green("evidence chain OK") : red(`${failures} failure(s)`)}\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(red(`\n${(e as Error).message}\n`));
  console.error(dim("Is it running?  cd evidence-service && npm run dev\n"));
  process.exit(1);
});
