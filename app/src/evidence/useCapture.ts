import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { backgroundRecordingAvailable } from "./background";

/**
 * The microphone. All of it.
 *
 * There is one microphone and two things want it: continuous evidence capture
 * (PRD R4) and hold-to-speak for transcription. Two `AudioRecorder` instances
 * recording at once do not work, so this owns the device and both consumers go
 * through it.
 *
 * The mechanism is one primitive — **rotation**. Stop the recording, take the
 * file, start a new one. Evidence capture rotates on a timer, every ten
 * seconds, because that is the chunk size R4 asks for. Hold-to-speak rotates
 * twice out of band: once when the button goes down and once when it comes up,
 * and the chunk between those two rotations *is* the utterance. That segment
 * is handed to speech-to-text **and** kept as evidence, so nothing the user
 * says is missing from the record because they were talking to the app.
 *
 * ## The gap
 *
 * `expo-audio` records to a single file and has no segmented mode. Rotation
 * therefore stops and restarts the recorder, and the milliseconds between the
 * two are not captured. There is no way around that inside Expo Go — proper
 * gapless segmentation needs a native module. The gap is small and it is at a
 * predictable place, but it is real, and a transcript assembled from these
 * chunks is not continuous audio. Do not describe it to a lawyer as if it
 * were.
 *
 * ## What happens when the screen locks
 *
 * In **Expo Go**, capture is foreground only: background recording on Android
 * needs a foreground service, which Expo Go cannot carry. Lock the phone and
 * capture stops; what survives is what the evidence service already
 * acknowledged, which is exactly the guarantee R4 states.
 *
 * In a **real build** (see app/BUILD.md), app.json asks expo-audio for a
 * microphone foreground service, and the recorder keeps running with the
 * screen off, under a persistent system notification — the recording stays
 * indicated, as R4 requires. What does *not* keep running is this file's
 * rotation timer: JavaScript timers are suspended in the background, so the
 * recording becomes one long chunk until the app is foregrounded again, and
 * that chunk is not off the phone until then. Background capture means
 * nothing is lost *if the phone is not taken*; it does not move the upload
 * forward. Never describe it as continuous off-device capture.
 *
 * UNTESTED ON A DEVICE as of 4 October 2026.
 */

export type PermissionState = "unknown" | "granted" | "denied";

export interface CapturedChunk {
  seq: number;
  uri: string;
  capturedAt: string;
  mime: string;
  /** True when this chunk is the span of a hold-to-speak press. */
  isSpeech: boolean;
}

/** Ten seconds, from R4: "when 10 seconds of audio exist, then that chunk is uploaded". */
const ROTATE_MS = 10_000;

/** Read once: the execution environment does not change while the app runs. */
const background = backgroundRecordingAvailable(Constants.executionEnvironment);

export function useCapture({ onChunk }: { onChunk: (chunk: CapturedChunk) => void }) {
  const recorder = useAudioRecorder(RecordingPresets.LOW_QUALITY);
  const state = useAudioRecorderState(recorder, 500);

  const [permission, setPermission] = useState<PermissionState>("unknown");
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Rotations must not overlap; a timer tick during a hold would corrupt both. */
  const rotating = useRef(false);
  const active = useRef(false);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { granted } = await requestRecordingPermissionsAsync();
        if (cancelled) return;
        setPermission(granted ? "granted" : "denied");
        if (granted) {
          await setAudioModeAsync({
            playsInSilentMode: true,
            allowsRecording: true,
            allowsBackgroundRecording: background,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setPermission("denied");
          setError((e as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Close the current recording and optionally open the next.
   *
   * `recorder.uri` is read immediately after `stop()` and before any
   * `prepareToRecordAsync()`, because preparing points it at the next file.
   */
  const rotate = useCallback(
    async (opts: { restart: boolean; isSpeech: boolean }): Promise<CapturedChunk | null> => {
      if (rotating.current) return null;
      rotating.current = true;
      try {
        await recorder.stop();
        const uri = recorder.uri;

        if (opts.restart) {
          await recorder.prepareToRecordAsync();
          recorder.record();
        }

        if (!uri) return null;
        const chunk: CapturedChunk = {
          seq: seq.current++,
          uri,
          capturedAt: new Date().toISOString(),
          mime: "audio/m4a",
          isSpeech: opts.isSpeech,
        };
        onChunkRef.current(chunk);
        return chunk;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        rotating.current = false;
      }
    },
    [recorder],
  );

  const start = useCallback(async (): Promise<boolean> => {
    if (active.current) return true;
    if (permission !== "granted") {
      setError("Microphone permission was not granted.");
      return false;
    }
    try {
      seq.current = 0;
      await recorder.prepareToRecordAsync();
      recorder.record();
      active.current = true;
      setCapturing(true);
      setError(null);
      timer.current = setInterval(() => {
        void rotate({ restart: true, isSpeech: false });
      }, ROTATE_MS);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }, [permission, recorder, rotate]);

  const stop = useCallback(async () => {
    if (!active.current) return;
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
    active.current = false;
    setCapturing(false);
    // The tail is evidence too — do not drop it because the session ended.
    await rotate({ restart: false, isSpeech: false });
  }, [rotate]);

  /**
   * Hold-to-speak. `beginSpeech` closes whatever is in progress so the
   * utterance starts clean; `endSpeech` closes the utterance and returns it
   * for transcription. Both chunks are delivered to `onChunk` regardless, so
   * evidence keeps everything.
   */
  const beginSpeech = useCallback(async () => {
    if (!active.current) {
      // Speaking without a capture session running: behave like the old
      // recorder so the composer still works with evidence capture off.
      if (permission !== "granted") {
        setError("Microphone permission was not granted.");
        return false;
      }
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    }
    await rotate({ restart: true, isSpeech: false });
    return true;
  }, [permission, recorder, rotate]);

  const endSpeech = useCallback(async (): Promise<CapturedChunk | null> => {
    return rotate({ restart: active.current, isSpeech: true });
  }, [rotate]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  return {
    start,
    stop,
    beginSpeech,
    endSpeech,
    capturing,
    isRecording: state.isRecording,
    durationMs: state.durationMillis ?? 0,
    permission,
    error,
    /** True only in a build that carries the microphone foreground service. */
    background,
  };
}
