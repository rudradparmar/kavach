import * as Location from "expo-location";
import type { AlertLocation } from "./message";

/**
 * Where the user is, for the alert.
 *
 * `getCurrentPositionAsync` has no timeout option and the Expo docs warn it
 * "may take some time to resolve, especially when you're inside a building".
 * An alert that waits indefinitely for a GPS fix is an alert that never goes,
 * so the fresh reading is raced against a deadline and falls back to the last
 * known position. A slightly stale location is worth far more than a spinner.
 */

const FRESH_TIMEOUT_MS = 6_000;
/** Anything older than this is not worth sending as "where they are". */
const LAST_KNOWN_MAX_AGE_MS = 10 * 60 * 1000;

export interface LocationResult {
  location: AlertLocation | null;
  /** Plain-language reason, for the recipient, when there is no location. */
  problem: string | null;
}

const toAlertLocation = (l: Location.LocationObject): AlertLocation => ({
  latitude: l.coords.latitude,
  longitude: l.coords.longitude,
  accuracyM: l.coords.accuracy ?? null,
  at: new Date(l.timestamp),
});

export async function getAlertLocation(): Promise<LocationResult> {
  let granted = false;
  try {
    const res = await Location.requestForegroundPermissionsAsync();
    granted = res.granted;
  } catch {
    return { location: null, problem: "the phone would not report its location" };
  }
  if (!granted) {
    return { location: null, problem: "location permission was not given on their phone" };
  }

  // Balanced rather than Highest: a street-level fix in a few seconds beats a
  // pavement-level one that arrives after the encounter is over.
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
    .then(toAlertLocation)
    .catch(() => null);

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), FRESH_TIMEOUT_MS));

  const current = await Promise.race([fresh, timeout]);
  if (current) return { location: current, problem: null };

  try {
    const last = await Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_MAX_AGE_MS });
    if (last) return { location: toAlertLocation(last), problem: null };
  } catch {
    // Fall through to the honest failure below.
  }

  return { location: null, problem: "their phone could not get a fix in time" };
}
