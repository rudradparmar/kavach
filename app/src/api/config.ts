import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { normalise } from "./url";

/**
 * Where the engine lives.
 *
 * Resolution order, most specific first:
 *   1. A value the user typed into Settings and we persisted.
 *   2. EXPO_PUBLIC_KAVACH_URL from the environment at bundle time.
 *   3. The Metro dev-server host with the port swapped to 8787.
 *
 * (3) is the one that matters day to day. The phone already knows the IP of
 * the machine serving the bundle, and that is almost always the same machine
 * running `npm run dev`. Deriving it means a laptop that changes networks does
 * not need a rebuild or a settings edit.
 */

const ENGINE_PORT = 8787;
const STORAGE_KEY = "kavach.baseUrl";

/** Metro serves the bundle from something like "192.168.1.8:8081" or "10.0.0.4:8081". */
function fromDevServer(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    null;
  if (!hostUri) return null;
  const host = hostUri.split(":")[0];
  if (!host) return null;
  return `http://${host}:${ENGINE_PORT}`;
}

function fromEnv(): string | null {
  const v = process.env.EXPO_PUBLIC_KAVACH_URL;
  return v && v.trim().length > 0 ? v.trim() : null;
}

/** What we would use if nothing is stored. Shown in Settings as the placeholder. */
export function defaultBaseUrl(): string {
  return fromEnv() ?? fromDevServer() ?? `http://localhost:${ENGINE_PORT}`;
}

export function describeDefaultSource(): string {
  if (fromEnv()) return "EXPO_PUBLIC_KAVACH_URL";
  if (fromDevServer()) return "derived from the Metro dev server host";
  return "fallback — no dev server host available";
}

/** Re-exported so callers do not need to know it lives in a platform-free module. */
export { normalise };

export async function loadBaseUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim().length > 0) return normalise(stored);
  } catch {
    // A storage failure must never stop a session from starting.
  }
  return normalise(defaultBaseUrl());
}

export async function saveBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, normalise(url));
}

export async function clearBaseUrl(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
