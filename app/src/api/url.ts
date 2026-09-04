/**
 * URL helpers with no platform dependency.
 *
 * Kept separate from config.ts because that module reaches for AsyncStorage,
 * which drags in React Native. Anything importing this can run under plain
 * Node — which is what lets scripts/ drive the real client code rather than a
 * reimplementation of it.
 */

/** Trailing slashes break path concatenation; strip them once, here. */
export function normalise(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** A sibling service's address, derived from the engine's. */
export interface Sibling {
  /** Used when the deployment is port-mounted. */
  port: number;
  /** Used when the deployment is path-mounted. */
  segment: string;
}

/**
 * Where a sibling service lives, given the engine's address.
 *
 * There are two deployment shapes, and the engine URL itself says which one
 * you are in:
 *
 *   Port-mounted — development. Three processes on one host, a port each:
 *     http://192.168.1.5:8787         ->  http://192.168.1.5:8788
 *
 *   Path-mounted — deployment. One hostname, one certificate, a reverse proxy
 *   routing by path prefix:
 *     https://api.example.com/engine  ->  https://api.example.com/stt
 *
 * The rule is the engine URL's own path. Carry one and you are path-mounted,
 * so the last segment is swapped. Carry none and the port is swapped.
 *
 * This function exists because the version before it always rebuilt
 * protocol + hostname + a hardcoded port, which cannot express the second
 * shape at all: on https://api.example.com — port 443 — it called :8788 and
 * failed. Every deployment behind TLS was unreachable, which made TLS itself
 * unreachable, which is why "add TLS" had been sitting at the top of the
 * handoff without moving.
 *
 * A deployment giving each service its own hostname fits neither shape. That
 * is what the explicit override in Settings is for.
 */
export function siblingUrl(engineBaseUrl: string, sibling: Sibling): string {
  let u: URL;
  try {
    u = new URL(normalise(engineBaseUrl));
  } catch {
    return "http://localhost:" + sibling.port;
  }

  const mountPath = u.pathname.replace(/\/+$/, "");
  if (mountPath.length > 0) {
    const parent = mountPath.slice(0, mountPath.lastIndexOf("/"));
    return u.origin + parent + "/" + sibling.segment;
  }
  return u.protocol + "//" + u.hostname + ":" + sibling.port;
}
