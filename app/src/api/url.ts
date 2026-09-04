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
