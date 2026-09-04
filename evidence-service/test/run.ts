import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EvidenceStore } from "../src/store.js";

/**
 * Same hand-rolled shape as the other packages: no framework, runs under tsx.
 *
 * These test custody properties, not plumbing. The reason this service exists
 * is that a lawyer can say "this file is the file that arrived at that time" —
 * so the hash, the server-side timestamp and the deletion path get the
 * attention, and the happy path gets the least.
 */

let pass = 0;
let fail = 0;
const group = (n: string) => console.log(`\n${n}`);

function t(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${(e as Error).message}`);
  }
}

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
const eq = <T,>(a: T, b: T, m: string) => {
  if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`);
};

const root = mkdtempSync(path.join(tmpdir(), "kavach-ev-"));
const newStore = (o: { retentionDays?: number; maxSessionBytes?: number } = {}) =>
  new EvidenceStore({ dir: mkdtempSync(path.join(root, "s-")), ...o });

const SID = "3c24bce5-7110-4342-a56d-26f43546089e";
const SID2 = "11111111-2222-3333-4444-555555555555";
const audio = (n: number, fill = 7) => Buffer.alloc(n, fill);

const put = (store: EvidenceStore, seq: number, body: Buffer, sessionId = SID) =>
  store.accept({
    sessionId,
    seq,
    body,
    mime: "audio/m4a",
    capturedAt: new Date().toISOString(),
    latitude: 28.6139,
    longitude: 77.209,
  });

/* ------------------------------------------------------------------ */
group("receipt");

t("a chunk is stored and comes back byte-identical", () => {
  const store = newStore();
  const body = audio(2048, 42);
  const r = put(store, 0, body);
  assert(r.ok, "accept failed");

  const back = store.readChunk(SID, 0);
  assert(back !== null, "chunk not readable");
  assert(back.body.equals(body), "bytes changed in storage");
});

t("the hash is computed over what arrived, not supplied by the uploader", () => {
  const store = newStore();
  const body = audio(4096, 99);
  const r = put(store, 0, body);
  assert(r.ok, "accept failed");
  eq(r.chunk.sha256, createHash("sha256").update(body).digest("hex"), "sha256");
});

t("two different chunks do not share a hash", () => {
  const store = newStore();
  const a = put(store, 0, audio(1024, 1));
  const b = put(store, 1, audio(1024, 2));
  assert(a.ok && b.ok, "accept failed");
  assert(a.chunk.sha256 !== b.chunk.sha256, "hashes collided on different content");
});

t("the receipt timestamp is the server's, and the device claim is kept beside it", () => {
  // A timestamp the phone controls is worth nothing in an argument about when
  // something happened.
  const store = newStore();
  const lie = "1999-01-01T00:00:00.000Z";
  const r = store.accept({
    sessionId: SID,
    seq: 0,
    body: audio(512),
    mime: "audio/m4a",
    capturedAt: lie,
    latitude: null,
    longitude: null,
  });
  assert(r.ok, "accept failed");
  eq(r.chunk.capturedAt, lie, "device claim should be preserved");
  assert(r.chunk.receivedAt !== lie, "server adopted the device's timestamp");
  assert(Date.parse(r.chunk.receivedAt) > Date.parse("2020-01-01"), "receipt time is not real");
});

t("location rides along with the audio", () => {
  const store = newStore();
  const r = put(store, 0, audio(256));
  assert(r.ok, "accept failed");
  eq(r.chunk.latitude, 28.6139, "latitude");
  eq(r.chunk.longitude, 77.209, "longitude");
});

/* ------------------------------------------------------------------ */
group("resilience");

t("re-uploading a sequence number is idempotent, not a duplicate recording", () => {
  // A client that uploaded but lost the acknowledgement will retry. Ten
  // seconds of an encounter must not end up stored twice.
  const store = newStore();
  const body = audio(1024, 5);
  const first = put(store, 3, body);
  const second = put(store, 3, body);
  assert(first.ok && second.ok, "accept failed");
  assert(!first.duplicate, "first upload reported as duplicate");
  assert(second.duplicate, "retry was not recognised");
  eq(store.readManifest(SID)?.chunks.length, 1, "stored twice");
});

t("out-of-order arrivals are stored in sequence order", () => {
  // A queue draining after reconnection does not arrive in order.
  const store = newStore();
  for (const seq of [4, 0, 2, 1, 3]) put(store, seq, audio(128, seq));
  const seqs = store.readManifest(SID)?.chunks.map((c) => c.seq);
  eq(JSON.stringify(seqs), JSON.stringify([0, 1, 2, 3, 4]), "manifest order");
});

t("acknowledged sequences are reportable, so a phone can resume", () => {
  // "Given the phone is switched off mid-session, all acknowledged chunks are
  // present" — this is how the client works out what it still owes.
  const store = newStore();
  for (const seq of [0, 1, 2, 5]) put(store, seq, audio(128, seq));
  eq(JSON.stringify(store.acknowledgedSeqs(SID)), JSON.stringify([0, 1, 2, 5]), "acks");
});

t("a manifest survives a fresh store over the same directory", () => {
  const store = newStore();
  put(store, 0, audio(512));
  put(store, 1, audio(512));
  const reopened = new EvidenceStore({ dir: store.dir });
  eq(reopened.readManifest(SID)?.chunks.length, 2, "chunks lost across restart");
  eq(reopened.acknowledgedSeqs(SID).length, 2, "acks lost across restart");
});

/* ------------------------------------------------------------------ */
group("refusals");

t("a session id that is not a uuid never reaches the filesystem", () => {
  const store = newStore();
  for (const evil of ["../../escape", "..", "a/b", ""]) {
    const r = store.accept({
      sessionId: evil,
      seq: 0,
      body: audio(64),
      mime: "audio/m4a",
      capturedAt: null,
      latitude: null,
      longitude: null,
    });
    assert(!r.ok, `accepted a bad session id: ${JSON.stringify(evil)}`);
    assert(!store.remove(evil), `removed a bad session id: ${JSON.stringify(evil)}`);
  }
});

t("an empty chunk and a negative sequence are refused", () => {
  const store = newStore();
  const empty = put(store, 0, Buffer.alloc(0));
  assert(!empty.ok, "accepted an empty chunk");
  const negative = put(store, -1, audio(64));
  assert(!negative.ok, "accepted a negative sequence");
});

t("one session cannot fill the disk", () => {
  const store = newStore({ maxSessionBytes: 4096 });
  assert(put(store, 0, audio(2048)).ok, "first chunk refused");
  assert(put(store, 1, audio(2048)).ok, "second chunk refused");
  const over = put(store, 2, audio(2048));
  assert(!over.ok, "accepted a chunk past the session limit");
  assert(over.ok === false && over.status === 413, "wrong status for over-limit");
});

t("a corrupt manifest does not take the service down", () => {
  const store = newStore();
  put(store, 0, audio(256));
  writeFileSync(path.join(store.dir, SID, "manifest.json"), "{ not json");
  eq(store.readManifest(SID), null, "corrupt manifest should read as absent");
  eq(store.readChunk(SID, 0), null, "should not serve a chunk it cannot account for");
});

/* ------------------------------------------------------------------ */
group("deletion and retention");

t("deletion is immediate and takes the audio with it (PRD R4)", () => {
  const store = newStore();
  put(store, 0, audio(1024));
  put(store, 1, audio(1024));
  assert(store.readManifest(SID) !== null, "setup failed");

  assert(store.remove(SID), "remove reported failure");
  eq(store.readManifest(SID), null, "manifest survived deletion");
  eq(store.readChunk(SID, 0), null, "audio survived deletion");
  eq(store.listSessions().length, 0, "session directory survived deletion");
});

t("deleting one session leaves the others alone", () => {
  const store = newStore();
  put(store, 0, audio(256), SID);
  put(store, 0, audio(256), SID2);
  store.remove(SID);
  eq(store.readManifest(SID), null, "target survived");
  assert(store.readManifest(SID2) !== null, "deleted an unrelated session");
});

t("retention sweeps what is old and spares what is not", () => {
  const store = newStore({ retentionDays: 30 });
  put(store, 0, audio(256), SID);
  put(store, 0, audio(256), SID2);

  // Age from the last chunk received, not from the directory's mtime.
  const p = path.join(store.dir, SID, "manifest.json");
  const m = JSON.parse(readFileSync(p, "utf8")) as { lastReceivedAt: string };
  m.lastReceivedAt = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  writeFileSync(p, JSON.stringify(m));

  eq(store.sweep(), 1, "sweep count");
  eq(store.readManifest(SID), null, "old session survived the sweep");
  assert(store.readManifest(SID2) !== null, "swept a session inside the window");
});

/* ------------------------------------------------------------------ */
rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
