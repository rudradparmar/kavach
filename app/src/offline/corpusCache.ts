import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCorpus } from "../api/client";
import type { CorpusPayload } from "../api/types";

/**
 * The corpus, kept on the device (PRD R10).
 *
 * The PRD is explicit that the offline case is not an edge case: "policing is
 * heaviest where signal is worst". The whole corpus is around 31KB, so there
 * is no reason to cache a subset and every reason not to — a partial cache
 * means discovering which scenario is missing at the checkpoint.
 *
 * The cache is stamped with the corpus version it came from and refreshed when
 * `/health` reports a different one. That matters beyond freshness: PRD R6
 * requires every answer to record which corpus version produced it, so that a
 * later correction can identify who was given bad guidance. A cache that
 * silently served an old version would break that trail.
 */

const STORAGE_KEY = "kavach.corpus.v1";

interface Cached {
  fetchedAt: string;
  payload: CorpusPayload;
}

export interface CorpusCacheState {
  payload: CorpusPayload | null;
  /** Where it came from — shown to the user, because it changes what is true. */
  source: "network" | "cache" | "none";
  fetchedAt: string | null;
  /** Set when the cached version no longer matches what the engine reports. */
  stale: boolean;
}

export const EMPTY: CorpusCacheState = {
  payload: null,
  source: "none",
  fetchedAt: null,
  stale: false,
};

async function readCache(): Promise<Cached | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached;
    // Defend against a truncated or half-written entry rather than rendering
    // a scenario card with missing fields.
    if (!parsed?.payload?.meta?.corpusVersion || !Array.isArray(parsed.payload.scenarios)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(payload: CorpusPayload): Promise<string> {
  const fetchedAt = new Date().toISOString();
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ fetchedAt, payload } satisfies Cached));
  } catch {
    // Out of space, or storage unavailable. The session still works; only the
    // offline path is lost, and the caller is told the source was "network".
  }
  return fetchedAt;
}

/**
 * Get the corpus, preferring a fresh copy but never failing because of the
 * network. `engineVersion` is what `/health` last reported, or null when the
 * engine is unreachable.
 */
export async function loadCorpusCache(
  baseUrl: string,
  apiKey: string | null,
  engineVersion: string | null,
): Promise<CorpusCacheState> {
  const cached = await readCache();
  const cachedVersion = cached?.payload.meta.corpusVersion ?? null;

  // Nothing to do if we already hold what the engine is serving.
  if (cached && engineVersion !== null && cachedVersion === engineVersion) {
    return { payload: cached.payload, source: "cache", fetchedAt: cached.fetchedAt, stale: false };
  }

  try {
    const payload = await getCorpus(baseUrl, apiKey);
    const fetchedAt = await writeCache(payload);
    return { payload, source: "network", fetchedAt, stale: false };
  } catch {
    if (!cached) return EMPTY;
    // Serving a known-stale corpus beats serving nothing, but the difference
    // has to be visible — the version is displayed on every card.
    return {
      payload: cached.payload,
      source: "cache",
      fetchedAt: cached.fetchedAt,
      stale: engineVersion !== null && cachedVersion !== engineVersion,
    };
  }
}

export async function clearCorpusCache(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
