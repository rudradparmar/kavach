import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import * as SecureStore from "expo-secure-store";
import { uploadChunk, type ChunkMeta, type ChunkReceipt } from "./client";

/**
 * The on-device evidence queue (PRD R4).
 *
 * "Given there is no connectivity, when the session runs, then chunks queue
 * encrypted on device and upload automatically on reconnection, with the user
 * told plainly that evidence is not yet safe."
 *
 * Every part of that sentence is load-bearing:
 *
 *   · **Queued**, so a bad network delays evidence rather than destroying it.
 *   · **Encrypted**, because the phone is the thing most likely to be taken.
 *     AES-256-GCM via `expo-crypto`, with the key in the platform keystore
 *     through `expo-secure-store` — never in AsyncStorage beside the data it
 *     protects.
 *   · **Automatically**, because a person in an encounter will not be tapping
 *     retry.
 *   · **Told plainly**, which is the caller's job and why `pending` and
 *     `safe` are separate numbers rather than a percentage.
 *
 * A chunk is deleted from the device only after the service acknowledges it.
 * An optimistic delete is the exact failure this whole path exists to prevent.
 */

const KEY_NAME = "kavach.evidenceKey.v1";
const INDEX_KEY = "kavach.evidenceQueue.v1";
const DIR_NAME = "kavach-evidence";

export interface QueuedChunk {
  sessionId: string;
  seq: number;
  /** Encrypted file on the device. */
  file: string;
  capturedAt: string;
  mime: string;
  /** Plaintext size, for reporting how much is waiting. */
  bytes: number;
  latitude: number | null;
  longitude: number | null;
}

export interface DrainReport {
  uploaded: number;
  failed: number;
  /** Set when the drain stopped early — almost always the network. */
  stoppedBecause: string | null;
}

/* ------------------------------------------------------------------ */
/* Key material                                                        */
/* ------------------------------------------------------------------ */

let cachedKey: Crypto.AESEncryptionKey | null = null;

/**
 * One key per install, held in the platform keystore.
 *
 * Losing it means losing anything still queued, which is the correct trade:
 * unreadable evidence is better than evidence readable by whoever ends up
 * holding the phone.
 */
async function getKey(): Promise<Crypto.AESEncryptionKey> {
  if (cachedKey) return cachedKey;

  let hex = await SecureStore.getItemAsync(KEY_NAME);
  if (!hex) {
    const bytes = Crypto.getRandomBytes(32);
    hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await SecureStore.setItemAsync(KEY_NAME, hex);
  }
  cachedKey = await Crypto.AESEncryptionKey.import(hex, "hex");
  return cachedKey;
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

function queueDir(): Directory {
  const dir = new Directory(Paths.cache, DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

async function readIndex(): Promise<QueuedChunk[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedChunk[];
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c?.file === "string") : [];
  } catch {
    return [];
  }
}

async function writeIndex(chunks: QueuedChunk[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(chunks));
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

/** Encrypt one recording and add it to the queue. Returns what is now waiting. */
export async function enqueue(
  sessionId: string,
  seq: number,
  sourceUri: string,
  meta: ChunkMeta,
): Promise<QueuedChunk> {
  const source = new File(sourceUri);
  const plaintext = source.bytesSync();

  const sealed = await Crypto.aesEncryptAsync(plaintext, await getKey());
  const combined = await sealed.combined();

  const target = new File(queueDir(), `${sessionId}-${String(seq).padStart(6, "0")}.enc`);
  target.write(combined);

  // The unencrypted recording does not linger next to its ciphertext.
  try {
    source.delete();
  } catch {
    /* the OS clears the cache eventually; not worth failing the capture over */
  }

  const chunk: QueuedChunk = {
    sessionId,
    seq,
    file: target.uri,
    capturedAt: meta.capturedAt,
    mime: meta.mime,
    bytes: plaintext.byteLength,
    latitude: meta.latitude,
    longitude: meta.longitude,
  };

  await writeIndex([...(await readIndex()), chunk]);
  return chunk;
}

/**
 * Send everything waiting, oldest first.
 *
 * Stops at the first network failure rather than hammering a dead connection:
 * the caller retries on a timer and on reconnection, and the chunks stay put
 * in the meantime.
 */
export async function drain(baseUrl: string, token: string | null, sessionId?: string): Promise<DrainReport> {
  const all = await readIndex();
  const mine = all
    .filter((c) => (sessionId ? c.sessionId === sessionId : true))
    .sort((a, b) => a.seq - b.seq);

  let uploaded = 0;
  let failed = 0;
  let stoppedBecause: string | null = null;
  const done = new Set<string>();

  for (const chunk of mine) {
    let receipt: ChunkReceipt;
    try {
      const file = new File(chunk.file);
      if (!file.exists) {
        // Nothing to send and nothing to recover; drop it from the index
        // rather than retrying forever.
        done.add(chunk.file);
        failed += 1;
        continue;
      }
      const sealed = Crypto.AESSealedData.fromCombined(file.bytesSync());
      const plaintext = await Crypto.aesDecryptAsync(sealed, await getKey());
      const bytes = typeof plaintext === "string" ? new TextEncoder().encode(plaintext) : plaintext;

      receipt = await uploadChunk(
        baseUrl,
        chunk.sessionId,
        chunk.seq,
        bytes,
        {
          capturedAt: chunk.capturedAt,
          mime: chunk.mime,
          latitude: chunk.latitude,
          longitude: chunk.longitude,
        },
        token,
      );
    } catch (e) {
      // Still owed. Leave it queued and stop — the network is the usual cause
      // and the next chunk will fail the same way.
      stoppedBecause = (e as Error).message;
      break;
    }

    // Acknowledged, and only now, the device copy goes.
    if (receipt.seq === chunk.seq) {
      done.add(chunk.file);
      uploaded += 1;
      try {
        new File(chunk.file).delete();
      } catch {
        /* the index entry is gone either way */
      }
    }
  }

  if (done.size > 0) {
    await writeIndex((await readIndex()).filter((c) => !done.has(c.file)));
  }
  return { uploaded, failed, stoppedBecause };
}

export async function pending(sessionId?: string): Promise<QueuedChunk[]> {
  const all = await readIndex();
  return sessionId ? all.filter((c) => c.sessionId === sessionId) : all;
}

/**
 * Forget what is queued for a session (PRD R4 deletion, device half).
 *
 * The service holds the other half; the caller does both, because evidence
 * deleted from only one place has not been deleted.
 */
export async function discard(sessionId: string): Promise<number> {
  const all = await readIndex();
  const mine = all.filter((c) => c.sessionId === sessionId);
  for (const c of mine) {
    try {
      new File(c.file).delete();
    } catch {
      /* already gone */
    }
  }
  await writeIndex(all.filter((c) => c.sessionId !== sessionId));
  return mine.length;
}

/**
 * Drop queued chunks the service already holds.
 *
 * Called when a session resumes after the app was killed: the phone may have
 * uploaded a chunk and died before recording the acknowledgement, and
 * re-sending is wasteful even though the service would deduplicate it.
 */
export async function reconcile(baseUrl: string, sessionId: string, acknowledged: number[]): Promise<number> {
  const acked = new Set(acknowledged);
  const all = await readIndex();
  const stale = all.filter((c) => c.sessionId === sessionId && acked.has(c.seq));
  for (const c of stale) {
    try {
      new File(c.file).delete();
    } catch {
      /* already gone */
    }
  }
  if (stale.length > 0) {
    await writeIndex(all.filter((c) => !(c.sessionId === sessionId && acked.has(c.seq))));
  }
  return stale.length;
}
