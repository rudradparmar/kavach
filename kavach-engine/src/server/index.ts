import http from "node:http";
import { Session } from "../engine/session.js";
import { buildPacket, packetToMarkdown } from "../engine/summary.js";
import { makeProviderAsync } from "../llm/anthropic.js";
import { loadCorpus } from "../corpus/loader.js";
import { SessionStore } from "./store.js";
import { installShutdown, startRetentionSweep } from "../../../shared/lifecycle.js";
import { clientKey, createRateLimiter } from "../../../shared/ratelimit.js";
import {
  describeAuth,
  loadAuthConfig,
  mintSessionToken,
  requireApiKey,
  requireSession,
} from "../../../shared/auth.js";
import type { LlmProvider } from "../llm/provider.js";

/**
 * The surface the Expo client talks to. Deliberately tiny.
 *
 * POST   /session            -> { sessionId }
 * POST   /session/:id/turn   -> { update, latencyMs }   body: { text, speaker? }
 * GET    /session/:id/packet -> markdown packet (?format=json for the structure)
 * DELETE /session/:id        -> permanent deletion (PRD R4)
 * GET    /corpus             -> scenarios for the offline cache (PRD R10)
 * GET    /health
 *
 * Sessions are persisted to disk so that a restart does not take the lawyer
 * packet with it. See store.ts for why that is not an unqualified win.
 */

const sessions = new Map<string, Session>();
const store = new SessionStore();
const auth = loadAuthConfig();
let provider: LlmProvider;

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
    // The Expo client is native and does not need this, but `expo start --web`
    // does, and a browser tab is the cheapest way to inspect a session.
    ...CORS,
  });
  res.end(s);
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 1_000_000) reject(new Error("body too large")); });
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });

/**
 * Slows down guessing at the instance key, which is one shared secret that
 * does not rotate.
 *
 * **A request carrying a valid credential is never refused by this.** The
 * limiter is consulted only after authorisation has already failed, which
 * matters more here than it would in most products. Many users in India reach
 * the internet through carrier-grade NAT, so a "client address" is routinely
 * shared by thousands of people. Throttling by address after a successful auth
 * would let one attacker -- or one looping client -- on a carrier lock real
 * users out of starting a session, and the moment they need to start one is a
 * police stop. Refusing a legitimate session is a worse outcome than any
 * amount of failed-credential traffic.
 *
 * The cost of ordering it this way is that an unauthenticated attacker still
 * makes the service do one HMAC comparison per attempt. That is cheap, and it
 * is the right thing to spend to keep the front door open.
 */
const authLimiter = createRateLimiter({ capacity: 20, refillPerMinute: 10 });

/**
 * Charges a token for a failed credential and answers 429 once the bucket is
 * empty. Returns true when the response is finished.
 *
 * Call this *after* the auth check fails, never before it.
 */
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
      const c = loadCorpus();
      return json(res, 200, {
        ok: true, provider: provider.name, corpusVersion: c.meta.corpusVersion,
        corpusStatus: c.meta.status, scenarios: c.scenarios.size, rules: c.rules.length,
        sessions: sessions.size,
        persistence: store.enabled ? { retentionDays: store.retentionDays } : false,
      });
    }

    if (req.method === "GET" && url.pathname === "/corpus") {
      const denied = requireApiKey(auth, req);
      if (denied) {
        if (chargeFailure(req, res)) return;
        return json(res, denied.status, { error: denied.error });
      }
      const c = loadCorpus();
      return json(res, 200, {
        meta: c.meta,
        scenarios: [...c.scenarios.values()],
        fallback: c.fallback,
        provisions: [...c.provisions.values()],
      });
    }

    if (req.method === "POST" && url.pathname === "/session") {
      const denied = requireApiKey(auth, req);
      if (denied) {
        if (chargeFailure(req, res)) return;
        return json(res, denied.status, { error: denied.error });
      }

      // Deliberately no cap on session creation by a caller holding a valid
      // key. Everyone on a deployment shares one instance key -- R1 forbids a
      // login -- so "one key creating many sessions" is exactly what normal
      // multi-user traffic looks like, and cannot be told apart from abuse.
      // Disk is bounded by retention and by the evidence service's per-session
      // cap instead, neither of which can refuse a person mid-encounter.
      const s = new Session(provider);
      sessions.set(s.state.sessionId, s);
      store.save(s.state);
      // The capability for this one encounter. The client carries it to the
      // speech and evidence services too; they verify it without asking here.
      return json(res, 201, {
        sessionId: s.state.sessionId,
        corpusVersion: s.state.corpusVersion,
        sessionToken: auth.enabled ? mintSessionToken(auth, s.state.sessionId) : null,
      });
    }

    if (parts[0] === "session" && parts[1]) {
      // Authorise before disclosing whether the session exists — a 404 that
      // only unauthenticated callers see is itself an oracle for which ids
      // are real.
      const denied = requireSession(auth, req, parts[1]);
      if (denied) {
        if (chargeFailure(req, res)) return;
        return json(res, denied.status, { error: denied.error });
      }

      const s = sessions.get(parts[1]);
      if (!s) return json(res, 404, { error: "unknown session" });

      if (req.method === "POST" && parts[2] === "turn") {
        // A session restored from disk carries the corpus version it was
        // recorded under. Adding turns from a different corpus would put two
        // versions in one audit trail, and PRD R6 exists so that a later
        // correction can identify exactly who received what. The packet is
        // still readable; only new turns are refused.
        const current = loadCorpus().meta.corpusVersion;
        if (s.state.corpusVersion !== current) {
          return json(res, 409, {
            error: "corpus version changed since this session started",
            detail: `session recorded under ${s.state.corpusVersion}, engine now serving ${current}. ` +
              `The packet can still be read; start a new session to continue.`,
            sessionCorpusVersion: s.state.corpusVersion,
            engineCorpusVersion: current,
          });
        }

        const body = JSON.parse((await readBody(req)) || "{}") as { text?: string; speaker?: "user" | "officer" | "unknown" };
        if (!body.text) return json(res, 400, { error: "text required" });
        const r = await s.ingest(body.text, body.speaker ?? "unknown");
        store.save(s.state);
        return json(res, 200, r);
      }

      if (req.method === "GET" && parts[2] === "packet") {
        const p = await buildPacket(s.state, provider);
        if (url.searchParams.get("format") === "json") return json(res, 200, p);
        const md = packetToMarkdown(p);
        res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", ...CORS });
        return res.end(md);
      }

      // PRD R4: the user can permanently delete a session's evidence.
      // Immediate, and it takes the file with it.
      if (req.method === "DELETE" && !parts[2]) {
        sessions.delete(parts[1]);
        const fileRemoved = store.remove(parts[1]);
        return json(res, 200, { deleted: true, fromDisk: fileRemoved });
      }

      if (req.method === "GET" && !parts[2]) return json(res, 200, s.state);
    }

    return json(res, 404, { error: "not found" });
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
});

const PORT = Number(process.env.PORT ?? 8787);
makeProviderAsync().then((p) => {
  provider = p;
  const c = loadCorpus();

  let sweeper: { intervalMinutes: number; sweptAtBoot: number; stop(): void } | null = null;
  if (store.enabled) {
    // Sweeps now and then on a timer. It used to sweep only here, which meant
    // a process that stayed up -- the whole point of a host that never sleeps
    // -- never enforced retention again after boot.
    sweeper = startRetentionSweep({
      label: "session store",
      sweep: () => store.sweep(),
      log: (m) => console.log(m),
    });
    for (const state of store.loadAll()) {
      sessions.set(state.sessionId, new Session(p, { state }));
    }
  }

  server.listen(PORT, () => {
    console.log(`kavach-engine on :${PORT}  provider=${p.name}  corpus=${c.meta.corpusVersion} (${c.meta.status})`);
    console.log(describeAuth(auth));
    console.log(
      store.enabled
        ? `  sessions: ${sessions.size} restored · persisted to ${store.dir} · kept ${store.retentionDays} days` +
            ` · swept every ${sweeper ? sweeper.intervalMinutes : 0}m`
        : "  sessions: in memory only (KAVACH_PERSIST_SESSIONS=0) — packets die with this process",
    );
    if (sweeper && sweeper.sweptAtBoot > 0) {
      console.log(`  swept ${sweeper.sweptAtBoot} session(s) past retention at boot`);
    }
    if (c.meta.status !== "counsel-signed-off") {
      console.log("\n  !! CORPUS IS UNVERIFIED — engineering use only. Do not put this in front of a user.\n");
    }
  });

  // A redeploy must not cut a turn mid-write. store.save() runs after every
  // turn, so at most the in-flight one is at risk, and this closes that.
  installShutdown({ label: "kavach-engine", server, onStop: () => sweeper?.stop() });
});
