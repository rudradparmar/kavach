import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Credentials the client carries.
 *
 * Two things, matching the two tiers the services enforce:
 *
 *   · the **instance key**, which says this app belongs to this deployment. It
 *     is typed in once, in Settings, and persisted.
 *   · a **session token**, minted by the engine when a session starts. It is a
 *     capability for that one encounter and it goes to all three services —
 *     the engine for turns and the packet, speech for transcription, evidence
 *     for the audio.
 *
 * The session token deliberately does not persist. It lives as long as the
 * session is on screen; a token sitting in storage after the encounter is over
 * is a capability nobody is using and someone could take.
 *
 * PRD R1 forbids a login, and there is not one — the user never has an
 * account, a password, or anything to remember. The single tap still starts a
 * session; it just carries a key the app already had.
 */

const API_KEY = "kavach.apiKey";

export async function loadApiKey(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(API_KEY);
    if (v && v.trim().length > 0) return v.trim();
  } catch {
    // Storage failure must not be indistinguishable from "no key set".
  }
  const fromEnv = process.env.EXPO_PUBLIC_KAVACH_API_KEY;
  return fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : null;
}

export async function saveApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    await AsyncStorage.removeItem(API_KEY);
    return;
  }
  await AsyncStorage.setItem(API_KEY, trimmed);
}

/** What every authenticated request sends. */
export function authHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Whether a failure is the credential rather than the network.
 *
 * Worth distinguishing in the UI: "the engine is down" and "this phone is not
 * allowed to talk to it" want completely different responses from the user.
 */
export function isAuthFailure(status: number | undefined): boolean {
  return status === 401 || status === 403;
}
