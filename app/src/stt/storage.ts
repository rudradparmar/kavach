import AsyncStorage from "@react-native-async-storage/async-storage";
import { normalise } from "../api/url";
import { defaultSttUrl } from "./client";

/**
 * Persistence for the speech service address.
 *
 * Split from client.ts so the transport stays free of React Native and can be
 * exercised from a plain Node script.
 */

const STORAGE_KEY = "kavach.sttUrl";

export async function loadSttUrl(engineBaseUrl: string): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && stored.trim().length > 0) return normalise(stored);
  } catch {
    // A storage failure must never stop a session from starting.
  }
  return normalise(defaultSttUrl(engineBaseUrl));
}

export async function saveSttUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, normalise(url));
}

export async function clearSttUrl(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
