/**
 * Whether the microphone can keep recording once the app is backgrounded or
 * the screen locks.
 *
 * It can only in a build that carries the foreground service app.json asks
 * expo-audio's config plugin for (`enableBackgroundRecording`). Expo Go is a
 * prebuilt app and carries no service of ours, so asking for background
 * recording there would promise something the phone will not do.
 *
 * Takes `Constants.executionEnvironment` as a plain string so it stays free of
 * React Native imports and can be pinned in app/scripts/units.ts.
 *   "storeClient" — Expo Go: foreground only.
 *   "standalone" / "bare" — a real build: background capable.
 */
export function backgroundRecordingAvailable(executionEnvironment: string | null | undefined): boolean {
  return executionEnvironment === "standalone" || executionEnvironment === "bare";
}
