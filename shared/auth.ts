import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type http from "node:http";

/**
 * Authentication across the three services.
 *
 * Until this existed, anyone who could reach a port could read a session's
 * transcript, download the audio of someone's encounter with police, or delete
 * it. The session ids are UUIDs and therefore not enumerable, but "hard to
 * guess" is an accident of the id format, not a control.
 *
 * ## Why capability tokens and not accounts
 *
 * PRD R1 is explicit: "Single tap starts a session — **no login**, no menu, no
 * scenario picker." A person at a checkpoint is not signing in. So there is no
 * user, no password, and nothing to remember — authorisation attaches to the
 * *session* instead of to a person.
 *
 * Two tiers:
 *
 *   1. **The instance key** proves you are a client of this deployment. It is
 *      needed to create a session or read the corpus, and nothing else.
 *   2. **A session token**, minted by the engine when a session starts, is a
 *      capability for that one session. It is what the app sends when adding a
 *      turn, building a packet, uploading a chunk of audio, or deleting any of
 *      it.
 *
 * A leaked session token exposes one encounter and expires. A leaked instance
 * key lets someone start new sessions, which is a nuisance rather than a
 * disclosure. That split is the whole point.
 *
 * ## Why HMAC and not a shared database
 *
 * `stt-service` and `evidence-service` deliberately know nothing about the
 * engine — an advocate reading `kavach-engine/` should find corpus, rules and
 * the guard, and nothing else. A signed token lets them verify a capability
 * the engine issued without a lookup, a round trip, or a dependency on it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SECRETS_FILE = path.resolve(HERE, "../.kavach-secrets.json");

export interface AuthConfig {
  /** False only when KAVACH_AUTH=0. Loud, deliberate, and never the default. */
  enabled: boolean;
  /** The key new clients should be given. Rotation makes this the *new* one. */
  apiKey: string;
  /**
   * Keys still accepted while a rotation is in progress, `apiKey` first.
   *
   * PRD R1 forbids a login, so every phone on a deployment shares one instance
   * key and there is no account to push a new one to. Without this, rotating
   * means every installed app stops working at the same instant — and the
   * instant a person notices is a police stop. So the old key keeps opening
   * the door while people update, and is dropped from the list afterwards.
   *
   * The window is the cost: a leaked key stays usable until it comes out of
   * `KAVACH_API_KEYS`. That is a deliberate trade against locking real users
   * out mid-encounter, and it is only defensible because the list is explicit
   * and someone has to remove the entry.
   */
  acceptedApiKeys: string[];
  /** The secret new session tokens are signed with. */
  sessionSecret: string;
  /**
   * Secrets that still verify a token, `sessionSecret` first.
   *
   * A session token lives for hours and is held by a phone in the middle of an
   * encounter. Rotating the signing secret without this would invalidate every
   * live session at once, which means the audio stops uploading and the packet
   * stops building, for everyone, immediately.
   */
  acceptedSessionSecrets: string[];
  /** How long a minted session token stays valid. */
  ttlMs: number;
  /** Where the secrets came from, for the boot banner. */
  source: "env" | "file" | "generated";
}

/** Comma or whitespace separated, empties dropped, order preserved. */
function splitKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(/[,\s]+/).map((k) => k.trim()).filter((k) => k.length > 0);
}

/** `primary` first, then any extras, without duplicates. */
function acceptList(primary: string, extras: string[]): string[] {
  const out = [primary];
  for (const k of extras) if (!out.includes(k)) out.push(k);
  return out;
}

interface SecretsFile {
  apiKey: string;
  sessionSecret: string;
  note: string;
}

/**
 * Secrets, in order: environment, then a gitignored file at the repo root,
 * then freshly generated into that file.
 *
 * The file exists so that `npm run dev` in three terminals works with no
 * setup and still has authentication switched on. Making the zero-config path
 * the *insecure* one is how services end up deployed wide open, so the
 * zero-config path here is the secure one and the escape hatch is explicit.
 */
export function loadAuthConfig(): AuthConfig {
  const enabled = process.env.KAVACH_AUTH !== "0";
  const ttlMs = Number(process.env.KAVACH_SESSION_TTL_HOURS ?? 12) * 60 * 60 * 1000;

  const envKey = process.env.KAVACH_API_KEY;
  const envSecret = process.env.KAVACH_SESSION_SECRET;
  // Rotation lists. Each names the keys that still work *besides* the current
  // one; the current one is always accepted and never has to be repeated.
  const extraKeys = splitKeys(process.env.KAVACH_API_KEYS);
  const extraSecrets = splitKeys(process.env.KAVACH_SESSION_SECRETS);

  if (envKey && envSecret) {
    return {
      enabled,
      apiKey: envKey,
      acceptedApiKeys: acceptList(envKey, extraKeys),
      sessionSecret: envSecret,
      acceptedSessionSecrets: acceptList(envSecret, extraSecrets),
      ttlMs,
      source: "env",
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8")) as SecretsFile;
    if (parsed?.apiKey && parsed?.sessionSecret) {
      const apiKey = envKey ?? parsed.apiKey;
      const sessionSecret = envSecret ?? parsed.sessionSecret;
      return {
        enabled,
        apiKey,
        acceptedApiKeys: acceptList(apiKey, extraKeys),
        sessionSecret,
        acceptedSessionSecrets: acceptList(sessionSecret, extraSecrets),
        ttlMs,
        source: "file",
      };
    }
  } catch {
    // Not there yet, or unreadable. Fall through and make one.
  }

  const generated: SecretsFile = {
    apiKey: randomBytes(24).toString("base64url"),
    sessionSecret: randomBytes(32).toString("base64url"),
    note: "Generated by Kavach on first boot. Development convenience. Set KAVACH_API_KEY and KAVACH_SESSION_SECRET from a secret manager for anything real, and never commit this file.",
  };
  try {
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(generated, null, 2), { mode: 0o600 });
  } catch {
    // Read-only checkout: the process still runs, it just gets a new key each
    // boot, which fails loudly rather than silently allowing everything.
  }
  return {
    enabled,
    apiKey: generated.apiKey,
    acceptedApiKeys: acceptList(generated.apiKey, extraKeys),
    sessionSecret: generated.sessionSecret,
    acceptedSessionSecrets: acceptList(generated.sessionSecret, extraSecrets),
    ttlMs,
    source: "generated",
  };
}

/* ------------------------------------------------------------------ */
/* Session tokens                                                       */
/* ------------------------------------------------------------------ */

const b64 = (b: Buffer) => b.toString("base64url");

function sign(secret: string, body: string): string {
  return b64(createHmac("sha256", secret).update(body).digest());
}

/** `kv1.<sessionId>.<expiryMs>.<signature>` */
export function mintSessionToken(config: AuthConfig, sessionId: string, now = Date.now()): string {
  const exp = now + config.ttlMs;
  const body = `kv1.${sessionId}.${exp}`;
  return `${body}.${sign(config.sessionSecret, body)}`;
}

export type TokenCheck =
  | { ok: true; sessionId: string; expiresAt: number }
  | { ok: false; reason: "malformed" | "bad-signature" | "expired" };

export function verifySessionToken(config: AuthConfig, token: string, now = Date.now()): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "kv1") return { ok: false, reason: "malformed" };

  const [, sessionId, expRaw, sig] = parts as [string, string, string, string];
  const exp = Number(expRaw);
  if (!Number.isFinite(exp)) return { ok: false, reason: "malformed" };

  // Every accepted secret is tried, and all of them are tried even after one
  // matches. Stopping early would make "signed with the retired secret" take
  // measurably longer than "signed with the current one", which leaks which
  // key a token came from to anyone timing the endpoint.
  const body = `kv1.${sessionId}.${expRaw}`;
  const a = Buffer.from(sig);
  let matched = false;
  for (const secret of acceptedSessionSecrets(config)) {
    const b = Buffer.from(sign(secret, body));
    if (a.length === b.length && timingSafeEqual(a, b)) matched = true;
  }
  if (!matched) return { ok: false, reason: "bad-signature" };

  // Signature before expiry: an attacker learns nothing from the ordering, and
  // an expired-but-valid token is a different problem from a forged one.
  if (exp < now) return { ok: false, reason: "expired" };

  return { ok: true, sessionId, expiresAt: exp };
}

/* ------------------------------------------------------------------ */
/* Request checking                                                     */
/* ------------------------------------------------------------------ */

export function bearer(req: http.IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (!raw || Array.isArray(raw)) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m?.[1] ?? null;
}

export interface Denial {
  status: number;
  error: string;
}

/** Constant-time string compare that does not leak length by throwing. */
export function secretEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The instance key. Guards session creation and the corpus.
 * Returns null when the request may proceed.
 */
export function requireApiKey(config: AuthConfig, req: http.IncomingMessage): Denial | null {
  if (!config.enabled) return null;
  const token = bearer(req);
  if (!token) return { status: 401, error: "missing bearer token" };
  if (!isAcceptedApiKey(config, token)) return { status: 403, error: "not a valid key for this deployment" };
  return null;
}

/** Any key still accepted during a rotation. Constant time across the list. */
export function isAcceptedApiKey(config: AuthConfig, candidate: string): boolean {
  let ok = false;
  for (const key of acceptedApiKeys(config)) if (secretEquals(candidate, key)) ok = true;
  return ok;
}

/** Defensive: a config built before these fields existed still works. */
const acceptedApiKeys = (c: AuthConfig): string[] =>
  c.acceptedApiKeys && c.acceptedApiKeys.length > 0 ? c.acceptedApiKeys : [c.apiKey];

const acceptedSessionSecrets = (c: AuthConfig): string[] =>
  c.acceptedSessionSecrets && c.acceptedSessionSecrets.length > 0
    ? c.acceptedSessionSecrets
    : [c.sessionSecret];

/**
 * A capability for one session.
 *
 * The token's session id must match the one in the path — a valid token for
 * *some* session must not open *every* session, which is the entire reason
 * these are per-session rather than one shared password.
 *
 * The instance key is accepted here too, so that operational tooling and the
 * replay harness are not locked out of their own deployment.
 */
export function requireSession(
  config: AuthConfig,
  req: http.IncomingMessage,
  sessionId: string,
): Denial | null {
  if (!config.enabled) return null;
  const token = bearer(req);
  if (!token) return { status: 401, error: "missing bearer token" };

  if (isAcceptedApiKey(config, token)) return null;

  const check = verifySessionToken(config, token);
  if (!check.ok) {
    return check.reason === "expired"
      ? { status: 401, error: "session token has expired" }
      : { status: 403, error: "not a valid session token" };
  }
  if (check.sessionId !== sessionId) {
    return { status: 403, error: "this token is for a different session" };
  }
  return null;
}

/** One line for the boot banner, so the posture is never a mystery. */
export function describeAuth(config: AuthConfig): string {
  if (!config.enabled) {
    return "  !! AUTH DISABLED (KAVACH_AUTH=0) — anyone who can reach this port can read and delete everything.";
  }
  const where =
    config.source === "env"
      ? "from the environment"
      : config.source === "file"
        ? "from .kavach-secrets.json"
        : "generated into .kavach-secrets.json";
  const rotating: string[] = [];
  if (acceptedApiKeys(config).length > 1) rotating.push(`${acceptedApiKeys(config).length} instance keys`);
  if (acceptedSessionSecrets(config).length > 1) rotating.push(`${acceptedSessionSecrets(config).length} session secrets`);
  const suffix = rotating.length > 0
    ? ` · ROTATING: ${rotating.join(", ")} accepted — retire the old ones once clients have updated`
    : "";
  return `  auth: on · secrets ${where}${suffix}`;
}
