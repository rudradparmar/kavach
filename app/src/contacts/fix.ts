import * as Location from "expo-location";

/**
 * A position fix for an evidence chunk (PRD R4: "continuous audio **and
 * periodic location** from session start").
 *
 * Deliberately separate from `getAlertLocation`. That one races a fresh
 * reading against a deadline because an alert that waits for GPS is an alert
 * that never goes; this one runs every ten seconds behind a chunk upload and
 * must never make the user wait for anything.
 *
 * Three properties follow:
 *
 *   · **It never asks for permission.** Permission is requested once, by the
 *     alert path or by the session starting, and this reads whatever is
 *     already granted. A permission dialog appearing mid-encounter, on top of
 *     the guidance, because a background timer fired, would be its own harm.
 *   · **It never blocks.** A fix that is not ready in a couple of seconds is
 *     skipped, and the chunk uploads without one. Audio with no coordinates
 *     is worth far more than coordinates that cost audio.
 *   · **It is cached briefly.** Ten-second chunks do not each need their own
 *     satellite fix, and asking for one that often is a battery cost during
 *     the exact minutes the phone must stay alive.
 */

export interface Fix {
  latitude: number;
  longitude: number;
}

/** A fix older than this is not worth attaching to a new chunk. */
const MAX_AGE_MS = 30_000;
/** Nothing waits longer than this for a position. */
const TIMEOUT_MS = 2_500;

let cached: { fix: Fix; at: number } | null = null;
let granted: boolean | null = null;

/** Reset between sessions so a stale position never lands on new audio. */
export function clearFixCache(): void {
  cached = null;
  granted = null;
}

async function permissionGranted(): Promise<boolean> {
  if (granted !== null) return granted;
  try {
    // getForegroundPermissionsAsync *reads* the state. requestForeground
    // would prompt, and prompting from a ten-second timer is not acceptable.
    const res = await Location.getForegroundPermissionsAsync();
    granted = res.granted;
  } catch {
    granted = false;
  }
  return granted;
}

/**
 * Best available position right now, or null. Never throws, never prompts,
 * never waits longer than {@link TIMEOUT_MS}.
 */
export async function currentFix(): Promise<Fix | null> {
  if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.fix;
  if (!(await permissionGranted())) return null;

  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .then((l): Fix => ({ latitude: l.coords.latitude, longitude: l.coords.longitude }))
    .catch(() => null);
  const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));

  let fix = await Promise.race([fresh, deadline]);
  if (!fix) {
    try {
      const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_AGE_MS });
      if (last) fix = { latitude: last.coords.latitude, longitude: last.coords.longitude };
    } catch {
      // No fix. The chunk goes without one, which is the correct trade.
    }
  }
  if (fix) cached = { fix, at: Date.now() };
  return fix;
}
