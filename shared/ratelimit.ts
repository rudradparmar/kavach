/**
 * In-process rate limiting.
 *
 * The instance key is a single shared secret that opens session creation and
 * the corpus, it does not rotate, and nothing slowed down someone guessing it.
 * Cloudflare's free plan allows one rate-limiting rule, which is worth having
 * at the edge but is not somewhere the whole defence should live: an edge rule
 * is a configuration in someone's dashboard, and this is code that ships with
 * the service and is tested with it.
 *
 * A token bucket, not a fixed window. A fixed window lets an attacker send a
 * full allowance at 59.9s and another at 60.1s; a bucket smooths that out and
 * still tolerates the bursts real clients produce.
 *
 * ## Identifying the client
 *
 * Behind Cloudflare Tunnel every request reaches the service from cloudflared,
 * and behind Caddy from Caddy. `req.socket.remoteAddress` is therefore the
 * same value for every user on earth, and limiting on it would throttle all of
 * them as one client while stopping no attacker.
 *
 * So the forwarded headers are used instead. They are trustworthy **only**
 * because of how this is deployed: no inbound port is open on the host, so
 * nothing but the tunnel can reach these processes, and cloudflared sets
 * `cf-connecting-ip` itself. Expose a port directly to the internet and these
 * headers become attacker-controlled and this limiter becomes decorative.
 */

import type { IncomingMessage } from "node:http";

export interface RateLimitOptions {
  /** Burst size: how many requests can arrive at once. */
  capacity: number;
  /** Sustained rate, in tokens added per minute. */
  refillPerMinute: number;
  /** Injectable for tests. */
  now?: () => number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Whole seconds until one token is available. 0 when allowed. */
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/** Buckets idle for this long are dropped, so the map cannot grow without bound. */
const IDLE_EVICT_MS = 30 * 60_000;

export interface RateLimiter {
  /** Spends a token for `key`. */
  take(key: string): RateLimitVerdict;
  /** Gives one back, for charging only the outcomes you care about. */
  refund(key: string): void;
  /** Live bucket count. Tests and /health. */
  size(): number;
}

export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const now = opts.now ?? (() => Date.now());
  const perMs = opts.refillPerMinute / 60_000;
  const buckets = new Map<string, Bucket>();
  let lastEvictMs = now();

  const evictIdle = (t: number) => {
    if (t - lastEvictMs < IDLE_EVICT_MS) return;
    lastEvictMs = t;
    for (const [k, b] of buckets) {
      if (t - b.lastRefillMs > IDLE_EVICT_MS) buckets.delete(k);
    }
  };

  const refill = (key: string, t: number): Bucket => {
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: opts.capacity, lastRefillMs: t };
      buckets.set(key, b);
      return b;
    }
    const gained = (t - b.lastRefillMs) * perMs;
    if (gained > 0) {
      b.tokens = Math.min(opts.capacity, b.tokens + gained);
      b.lastRefillMs = t;
    }
    return b;
  };

  return {
    take(key) {
      const t = now();
      evictIdle(t);
      const b = refill(key, t);

      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }
      const waitMs = (1 - b.tokens) / perMs;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
    },

    refund(key) {
      const b = buckets.get(key);
      if (b) b.tokens = Math.min(opts.capacity, b.tokens + 1);
    },

    size: () => buckets.size,
  };
}

/**
 * Who is asking, as well as this can be known.
 *
 * Order matters: cloudflared sets `cf-connecting-ip` and it cannot be spoofed
 * through the tunnel, so it wins. `x-forwarded-for` is next, taking the
 * left-most entry, which is the original client. The socket address is the
 * last resort and is only meaningful in development, where there is no proxy.
 */
export function clientKey(req: IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();

  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff[0] : xff;
  if (typeof raw === "string" && raw.trim()) {
    const first = raw.split(",")[0]?.trim();
    if (first) return first;
  }

  return req.socket.remoteAddress ?? "unknown";
}
