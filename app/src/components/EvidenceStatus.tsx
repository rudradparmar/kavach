import { StyleSheet, Text, View } from "react-native";
import { colour, radius, space, type } from "../theme";

/**
 * How much of this encounter is actually off the phone (PRD R4).
 *
 * Two counts, never a percentage. "3 still on this phone" is something a
 * person can act on — wait, move, find signal — and "80% uploaded" is not.
 *
 * The wording is deliberately blunt in the bad case. R4 requires the user be
 * "told plainly that evidence is not yet safe", and the whole premise of the
 * feature is the PRD's second design principle: the phone is not safe, so
 * anything still on it can be taken. A reassuring "syncing…" would be a lie of
 * tone even with honest numbers underneath.
 */
export function EvidenceStatus({
  capturing,
  safe,
  pendingCount,
  serviceReachable,
  error,
  background = false,
}: {
  capturing: boolean;
  /** Chunks the service has acknowledged. These survive the phone. */
  safe: number;
  /** Chunks still on the device, encrypted, waiting for a network. */
  pendingCount: number;
  serviceReachable: boolean;
  error: string | null;
  /**
   * Whether recording survives the screen locking. Said either way, because
   * someone who locks their phone mid-encounter needs to know which of the two
   * just happened, and the answer depends on how the app was installed.
   */
  background?: boolean;
}) {
  if (!capturing && safe === 0 && pendingCount === 0) return null;

  const atRisk = pendingCount > 0 || !serviceReachable;

  return (
    <View style={[s.wrap, atRisk ? s.wrapRisk : s.wrapSafe]}>
      <View style={s.head}>
        {/* PRD R4: "recording is visually and audibly indicated — no covert
            capture." This is the visual half, and it is never hidden. */}
        {capturing ? <View style={s.dot} /> : null}
        <Text style={[s.title, atRisk ? s.titleRisk : s.titleSafe]}>
          {capturing ? "RECORDING" : "RECORDING STOPPED"}
        </Text>
      </View>

      {!serviceReachable ? (
        <Text style={s.body}>
          Nothing is leaving this phone — the evidence service cannot be reached. Everything
          recorded is encrypted here and will upload by itself when there is a connection.
        </Text>
      ) : pendingCount > 0 ? (
        <Text style={s.body}>
          {safe} piece{safe === 1 ? "" : "s"} safely off this phone.{" "}
          <Text style={s.emphasis}>
            {pendingCount} still on it
          </Text>{" "}
          — if the phone is taken now, those are gone.
        </Text>
      ) : safe > 0 ? (
        <Text style={s.body}>
          {safe} piece{safe === 1 ? "" : "s"} safely off this phone. If it is taken now, the
          recording survives.
        </Text>
      ) : (
        <Text style={s.body}>Recording. Nothing has been uploaded yet.</Text>
      )}

      {capturing ? (
        <Text style={s.note}>
          {background
            ? "Keeps recording if the screen locks. What is recorded while locked uploads when you reopen Kavach."
            : "Recording stops if the screen locks or you leave the app. Keep Kavach open."}
        </Text>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  wrapSafe: { borderColor: colour.safest, backgroundColor: colour.safestBg },
  wrapRisk: { borderColor: colour.warn, backgroundColor: colour.warnBg },

  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colour.unlawful },
  title: { fontSize: type.small, fontWeight: "800", letterSpacing: 1.2 },
  titleSafe: { color: colour.safest },
  titleRisk: { color: colour.warn },

  body: { color: colour.text, fontSize: type.small, lineHeight: 18 },
  emphasis: { fontWeight: "800", color: colour.warn },
  note: { color: colour.textFaint, fontSize: type.small, lineHeight: 16 },
  error: { color: colour.textFaint, fontSize: type.small, lineHeight: 16 },
});
