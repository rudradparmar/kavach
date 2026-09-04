import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionState } from "../types.js";

/**
 * Session storage.
 *
 * Sessions used to live in a `Map` and die with the process, taking the lawyer
 * packet with them. That made the packet — the artifact the whole product
 * exists to produce — dependent on nobody restarting the engine.
 *
 * Making it durable is not a free win, and the PRD says so directly: "where
 * does evidence live, under whose jurisdiction, and who can be compelled to
 * produce it? A subpoena to the evidence host is a foreseeable attack on the
 * product's core promise." What is written here is a verbatim transcript of an
 * encounter with police, including the user's own words.
 *
 * So durability ships with the things that make it defensible rather than
 * after them:
 *
 *   · **Deletion.** PRD R4 requires a user to be able to permanently delete a
 *     session, honoured within 24 hours. `remove()` is immediate.
 *   · **Retention.** Files older than the retention window are swept on boot.
 *     Evidence that nobody has collected in a week is a liability, not an
 *     asset.
 *   · **An off switch.** `KAVACH_PERSIST_SESSIONS=0` restores the old
 *     behaviour exactly, for anyone who decides the trade is wrong.
 *
 * None of that answers the PRD's question. It just keeps the answer open.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(HERE, "../../sessions");

/**
 * Session ids are `randomUUID()` output, but `remove()` is reachable from a
 * URL path segment, so the id is validated as a UUID before it is ever joined
 * onto a directory path. A store that will write to `../../etc/anything`
 * because someone asked nicely is not hardening.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoreOptions {
  enabled?: boolean;
  dir?: string;
  retentionDays?: number;
}

export class SessionStore {
  readonly enabled: boolean;
  readonly dir: string;
  readonly retentionDays: number;

  constructor(opts: StoreOptions = {}) {
    this.enabled = opts.enabled ?? process.env.KAVACH_PERSIST_SESSIONS !== "0";
    this.dir = opts.dir ?? process.env.KAVACH_SESSION_DIR ?? DEFAULT_DIR;
    this.retentionDays = opts.retentionDays ?? Number(process.env.KAVACH_SESSION_RETENTION_DAYS ?? 7);

    if (this.enabled) fs.mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(sessionId: string): string | null {
    if (!UUID.test(sessionId)) return null;
    return path.join(this.dir, `${sessionId}.json`);
  }

  /**
   * Write one session.
   *
   * Synchronous and via a temp file plus rename. Synchronous because these are
   * a few KB and ordering matters more than throughput here; atomic because
   * the entire reason this exists is surviving a process that stops without
   * warning, and a half-written packet is worse than none.
   */
  save(state: SessionState): void {
    if (!this.enabled) return;
    const file = this.fileFor(state.sessionId);
    if (!file) return;
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(state), "utf8");
      fs.renameSync(tmp, file);
    } catch (e) {
      // A failed write must never fail the turn — the user is at a checkpoint.
      console.error(`session store: could not save ${state.sessionId}: ${(e as Error).message}`);
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* nothing further to do */
      }
    }
  }

  /** Everything on disk. A corrupt file is skipped, never fatal. */
  loadAll(): SessionState[] {
    if (!this.enabled) return [];
    let names: string[];
    try {
      names = fs.readdirSync(this.dir).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }

    const out: SessionState[] = [];
    for (const name of names) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(this.dir, name), "utf8")) as SessionState;
        // Defend against a truncated or hand-edited file rather than letting a
        // malformed session reach the rule engine.
        if (typeof parsed?.sessionId === "string" && Array.isArray(parsed.turns)) {
          out.push(parsed);
        } else {
          console.error(`session store: ${name} is not a session, skipping`);
        }
      } catch (e) {
        console.error(`session store: could not read ${name}: ${(e as Error).message}`);
      }
    }
    return out;
  }

  /** PRD R4 — permanent, immediate. Returns false if there was nothing to remove. */
  remove(sessionId: string): boolean {
    if (!this.enabled) return false;
    const file = this.fileFor(sessionId);
    if (!file) return false;
    try {
      fs.rmSync(file, { force: true });
      return true;
    } catch (e) {
      console.error(`session store: could not delete ${sessionId}: ${(e as Error).message}`);
      return false;
    }
  }

  /**
   * Delete sessions older than the retention window. Returns how many went.
   *
   * Keyed off `startedAt` rather than file mtime, because a session rewritten
   * on its last turn should still age from when the encounter happened.
   */
  sweep(now: Date = new Date()): number {
    if (!this.enabled || !Number.isFinite(this.retentionDays) || this.retentionDays <= 0) return 0;
    const cutoff = now.getTime() - this.retentionDays * 24 * 60 * 60 * 1000;

    let removed = 0;
    for (const state of this.loadAll()) {
      const started = Date.parse(state.startedAt);
      if (Number.isFinite(started) && started < cutoff) {
        if (this.remove(state.sessionId)) removed += 1;
      }
    }
    return removed;
  }
}
