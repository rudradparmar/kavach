/**
 * PRD R1 asks for a session to start from one tap, with no menu in the way.
 * The home-screen shortcut (app/plugins/withPanicShortcut.js) and anything
 * else that wants that tap — a future quick-settings tile, a widget — opens
 * `kavach://start`, and the app starts a session as soon as it can.
 *
 * Pure on purpose: no React Native import, so app/scripts/units.ts can pin it.
 *
 * Starting from a link is safe to allow from anywhere because of what it
 * does: it opens a session in the user's own app, on their own screen, with
 * the recording indicator showing. It sends nothing and shares nothing.
 */
export const PANIC_URL = "kavach://start";

export function isPanicUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const m = /^kavach:\/\/\/?([^?#]*)/i.exec(url.trim());
  if (!m) return false;
  return m[1].replace(/\/+$/, "").toLowerCase() === "start";
}
