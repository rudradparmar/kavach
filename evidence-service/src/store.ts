import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Evidence custody (PRD R4).
 *
 * "The phone is not safe" is the PRD's second design principle: phones get
 * taken, switched off and handed over, and evidence that lives only on the
 * device is evidence that can disappear. This service exists so that audio
 * captured during an encounter stops depending on the survival of the handset
 * that captured it.
 *
 * Two properties make a stored chunk worth anything to a lawyer, and both are
 * established **here, at receipt** rather than taken from the client:
 *
 *   · a **timestamp** the device cannot influence, and
 *   · a **SHA-256 content hash** computed over the bytes as they arrived.
 *
 * A hash the uploader supplies proves nothing — it attests only that the
 * uploader is consistent with itself. Recomputing it on arrival is what lets
 * someone later say this file is the file that was received at that moment.
 *
 * Same trade as the session store, one step more serious: this is audio of a
 * police encounter, and the PRD's open question about who can be compelled to
 * produce it applies here first. So deletion is immediate, retention is
 * bounded, and per-session size is capped.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(HERE, "../evidence");

/** Session ids reach this from URL path segments. Nothing else is joined to a path. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXT: Record<string, string> = {
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/3gpp": "3gp",
  "audio/wav": "wav",
};

export interface ChunkRecord {
  seq: number;
  /** Server clock at receipt. The client does not get a say in this. */
  receivedAt: string;
  /** What the device claimed, kept alongside rather than instead of the above. */
  capturedAt: string | null;
  sha256: string;
  bytes: number;
  mime: string;
  file: string;
  /** Where the phone was, if it offered a fix. PRD R4: audio *and* location. */
  latitude: number | null;
  longitude: number | null;
}

export interface Manifest {
  sessionId: string;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  chunks: ChunkRecord[];
  totalBytes: number;
}

export interface AcceptInput {
  sessionId: string;
  seq: number;
  body: Buffer;
  mime: string;
  capturedAt: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type AcceptResult =
  | { ok: true; chunk: ChunkRecord; duplicate: boolean }
  | { ok: false; status: number; error: string };

export interface StoreOptions {
  dir?: string;
  retentionDays?: number;
  maxSessionBytes?: number;
}

export class EvidenceStore {
  readonly dir: string;
  readonly retentionDays: number;
  readonly maxSessionBytes: number;

  constructor(opts: StoreOptions = {}) {
    this.dir = opts.dir ?? process.env.KAVACH_EVIDENCE_DIR ?? DEFAULT_DIR;
    this.retentionDays = opts.retentionDays ?? Number(process.env.KAVACH_EVIDENCE_RETENTION_DAYS ?? 30);
    this.maxSessionBytes =
      opts.maxSessionBytes ?? Number(process.env.KAVACH_EVIDENCE_MAX_SESSION_MB ?? 200) * 1024 * 1024;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private sessionDir(sessionId: string): string | null {
    if (!UUID.test(sessionId)) return null;
    return path.join(this.dir, sessionId);
  }

  private manifestPath(sessionId: string): string | null {
    const d = this.sessionDir(sessionId);
    return d ? path.join(d, "manifest.json") : null;
  }

  readManifest(sessionId: string): Manifest | null {
    const p = this.manifestPath(sessionId);
    if (!p) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Manifest;
      if (typeof parsed?.sessionId !== "string" || !Array.isArray(parsed.chunks)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private writeManifest(m: Manifest): void {
    const p = this.manifestPath(m.sessionId);
    if (!p) return;
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(m, null, 2), "utf8");
    fs.renameSync(tmp, p);
  }

  /**
   * Take one chunk.
   *
   * Idempotent on `seq`: a client that uploaded successfully but lost the
   * acknowledgement will retry, and it must not end up with the same ten
   * seconds stored twice under different numbers. A repeat of a sequence
   * number already held is answered with the original record.
   */
  accept(input: AcceptInput): AcceptResult {
    const dir = this.sessionDir(input.sessionId);
    if (!dir) return { ok: false, status: 400, error: "session id must be a uuid" };
    if (!Number.isInteger(input.seq) || input.seq < 0) {
      return { ok: false, status: 400, error: "seq must be a non-negative integer" };
    }
    if (input.body.byteLength === 0) return { ok: false, status: 400, error: "empty chunk" };

    fs.mkdirSync(dir, { recursive: true });
    const existing = this.readManifest(input.sessionId) ?? {
      sessionId: input.sessionId,
      firstReceivedAt: null,
      lastReceivedAt: null,
      chunks: [],
      totalBytes: 0,
    };

    const already = existing.chunks.find((c) => c.seq === input.seq);
    if (already) return { ok: true, chunk: already, duplicate: true };

    if (existing.totalBytes + input.body.byteLength > this.maxSessionBytes) {
      return { ok: false, status: 413, error: "session evidence limit reached" };
    }

    const receivedAt = new Date().toISOString();
    // Computed over the bytes as they arrived, never taken from the uploader.
    const sha256 = createHash("sha256").update(input.body).digest("hex");
    const ext = EXT[input.mime] ?? "bin";
    const file = `${String(input.seq).padStart(6, "0")}.${ext}`;

    const tmp = path.join(dir, `${file}.tmp`);
    fs.writeFileSync(tmp, input.body);
    fs.renameSync(tmp, path.join(dir, file));

    const chunk: ChunkRecord = {
      seq: input.seq,
      receivedAt,
      capturedAt: input.capturedAt,
      sha256,
      bytes: input.body.byteLength,
      mime: input.mime,
      file,
      latitude: input.latitude,
      longitude: input.longitude,
    };

    existing.chunks.push(chunk);
    existing.chunks.sort((a, b) => a.seq - b.seq);
    existing.totalBytes += chunk.bytes;
    existing.firstReceivedAt ??= receivedAt;
    existing.lastReceivedAt = receivedAt;
    this.writeManifest(existing);

    return { ok: true, chunk, duplicate: false };
  }

  /** The bytes of one chunk, for playback or for a lawyer's bundle. */
  readChunk(sessionId: string, seq: number): { body: Buffer; mime: string } | null {
    const dir = this.sessionDir(sessionId);
    const manifest = this.readManifest(sessionId);
    if (!dir || !manifest) return null;
    const record = manifest.chunks.find((c) => c.seq === seq);
    if (!record) return null;
    try {
      return { body: fs.readFileSync(path.join(dir, record.file)), mime: record.mime };
    } catch {
      return null;
    }
  }

  /** PRD R4 — permanent, immediate, audio included. */
  remove(sessionId: string): boolean {
    const dir = this.sessionDir(sessionId);
    if (!dir) return false;
    try {
      if (!fs.existsSync(dir)) return false;
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  listSessions(): string[] {
    try {
      return fs
        .readdirSync(this.dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && UUID.test(e.name))
        .map((e) => e.name);
    } catch {
      return [];
    }
  }

  /** Delete sessions whose last chunk arrived outside the retention window. */
  sweep(now: Date = new Date()): number {
    if (!Number.isFinite(this.retentionDays) || this.retentionDays <= 0) return 0;
    const cutoff = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const id of this.listSessions()) {
      const m = this.readManifest(id);
      const last = Date.parse(m?.lastReceivedAt ?? "");
      if (Number.isFinite(last) && last < cutoff) {
        if (this.remove(id)) removed += 1;
      }
    }
    return removed;
  }

  /**
   * What the client needs to resume after a restart: the sequence numbers this
   * service already holds. A phone that comes back from being switched off can
   * then upload only what was never acknowledged.
   */
  acknowledgedSeqs(sessionId: string): number[] {
    return (this.readManifest(sessionId)?.chunks ?? []).map((c) => c.seq).sort((a, b) => a - b);
  }
}
