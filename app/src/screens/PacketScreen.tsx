import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { deleteSession, getPacketJson, getPacketMarkdown } from "../api/client";
import type { IncidentPacket } from "../api/types";
import { FlagList } from "../components/Flags";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * The incident packet (PRD R8).
 *
 * HANDOFF calls this "the artifact that makes the ninety seconds worth
 * anything afterwards", and the PRD's target is that an advocate can act on it
 * without a follow-up call. Two things follow:
 *
 *   · It is rendered from the packet JSON, not the markdown, so flags and
 *     provisions go through the same components as the live screens. An
 *     advocate should not be reading a differently-styled account of the same
 *     facts, and a second renderer would be a second place for corpus text to
 *     drift.
 *   · The unverified warning goes at the top. An advocate must know the
 *     provisions are placeholders *before* reading them, not after.
 *
 * Sharing sends a record of a police encounter off the device, so it asks
 * first, in plain terms, every time.
 */
export function PacketScreen({
  baseUrl,
  sessionId,
  sessionToken,
  onDeleteEvidence,
  retentionDays,
  onDone,
}: {
  baseUrl: string;
  sessionId: string;
  /** The capability for this encounter; every call needs it. */
  sessionToken: string | null;
  /** Removes the audio too — from the device queue and from the service. */
  onDeleteEvidence: () => Promise<void>;
  /** How long the engine keeps this, or null when it keeps nothing. */
  retentionDays: number | null;
  /** Clears the session from this screen and returns to the start screen. */
  onDone: () => void;
}) {
  const [packet, setPacket] = useState<IncidentPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getPacketJson(baseUrl, sessionId, sessionToken)
      .then((p) => {
        if (!cancelled) setPacket(p);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, sessionId, sessionToken]);

  const doShare = useCallback(async () => {
    setSharing(true);
    setError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setError("This device has no way to share a file.");
        return;
      }
      const markdown = await getPacketMarkdown(baseUrl, sessionId, sessionToken);
      const name = `kavach-incident-${sessionId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.md`;
      const file = new File(Paths.cache, name);
      file.write(markdown);
      await Sharing.shareAsync(file.uri, {
        mimeType: "text/markdown",
        dialogTitle: "Send the incident packet",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSharing(false);
    }
  }, [baseUrl, sessionId, sessionToken]);

  /**
   * Confirmation is not ceremony here. The packet contains a verbatim
   * transcript of an encounter with police, the user's own words included, and
   * once it leaves the device they cannot take it back.
   */
  const confirmShare = useCallback(() => {
    Alert.alert(
      "Send this packet?",
      "It contains the full transcript of the encounter, the times, and everything the app recorded. " +
        "Once you send it you cannot unsend it. Send it to a lawyer you have chosen.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Send", style: "default", onPress: () => void doShare() },
      ],
    );
  }, [doShare]);

  /**
   * PRD R4: "the user can permanently delete a session's evidence."
   *
   * The engine keeps this record on disk so a restart does not destroy it,
   * which means walking away no longer erases anything. Deletion is the other
   * half of that trade, and it has to be reachable from the screen where the
   * user is looking at what would be deleted.
   */
  const doDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      // Both halves, or it has not been deleted: the transcript on the engine
      // and the audio in the evidence service and the device queue.
      await Promise.all([deleteSession(baseUrl, sessionId, sessionToken), onDeleteEvidence()]);
      onDone();
    } catch (e) {
      setError(`Could not delete it: ${(e as Error).message}`);
      setDeleting(false);
    }
  }, [baseUrl, sessionId, sessionToken, onDone]);

  const confirmDelete = useCallback(() => {
    Alert.alert(
      "Delete this record?",
      "The transcript, the times, and the audio recorded during the encounter will all be " +
        "erased — from this phone and from the server. " +
        "This cannot be undone, and anything you have already sent stays sent.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void doDelete() },
      ],
    );
  }, [doDelete]);

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Incident packet</Text>
        <Pressable onPress={onDone} style={s.done} accessibilityRole="button" hitSlop={8}>
          <Text style={s.doneText}>Done</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.centre}>
          <ActivityIndicator color={colour.text} />
          <Text style={s.centreText}>Building the packet…</Text>
        </View>
      ) : packet ? (
        <>
          <ScrollView contentContainerStyle={s.scroll}>
            {packet.unverifiedContentWarning ? (
              <View style={s.warning}>
                <Text style={s.warningTitle}>UNVERIFIED CONTENT — NOT FOR FILING</Text>
                <Text style={s.warningBody}>{packet.unverifiedContentWarning}</Text>
              </View>
            ) : null}

            <Meta packet={packet} />

            <Section title="SUMMARY">
              <View style={s.card}>
                <Text style={s.caveat}>
                  Machine-generated. Contains no legal analysis. Verify against the transcript
                  below.
                </Text>
                <Text style={s.body}>{packet.narrative}</Text>
              </View>
            </Section>

            {packet.flags.length > 0 ? (
              <Section title={`CONCERNS FLAGGED (${packet.flags.length})`}>
                <FlagList flags={packet.flags} />
              </Section>
            ) : (
              <Section title="CONCERNS FLAGGED">
                <View style={s.card}>
                  <Text style={s.body}>
                    None. The rule engine did not identify a provision-backed concern from the
                    facts established.
                  </Text>
                </View>
              </Section>
            )}

            {packet.scenariosTraversed.length > 0 ? (
              <Section title="HOW THE ENCOUNTER MOVED">
                <View style={s.card}>
                  {packet.scenariosTraversed.map((sc, i) => (
                    <View key={`${sc.scenarioId}-${i}`} style={s.row}>
                      <Text style={s.rowKey}>turn {sc.fromTurn}</Text>
                      <Text style={s.rowVal}>{sc.title}</Text>
                    </View>
                  ))}
                </View>
              </Section>
            ) : null}

            {packet.factsEstablished.length > 0 ? (
              <Section title={`FACTS ESTABLISHED (${packet.factsEstablished.length})`}>
                <View style={[s.card, { gap: space.md }]}>
                  {packet.factsEstablished.map((f, i) => (
                    <View key={`${f.fact}-${i}`} style={{ gap: 2 }}>
                      <Text style={s.factLine}>
                        <Text style={s.factKey}>{f.fact}</Text> = {String(f.value)}
                      </Text>
                      {/* The verbatim quote is the whole point — every fact in
                          this packet is traceable to something that was said. */}
                      <Text style={s.evidence}>“{f.evidence.trim()}”</Text>
                    </View>
                  ))}
                </View>
              </Section>
            ) : null}

            {packet.provisionsSurfaced.length > 0 ? (
              <Section title="PROVISIONS SURFACED">
                <View style={[s.card, { gap: space.md }]}>
                  {packet.provisionsSurfaced.map((p) => (
                    <View key={p.id} style={{ gap: 2 }}>
                      <Text style={s.provisionCite}>
                        {p.act} {p.section}
                      </Text>
                      <Text style={s.provisionSummary}>{p.summary}</Text>
                      {p.verification.status !== "counsel-signed-off" ? (
                        <Text style={s.provisionUnverified}>
                          {p.verification.status} — not checked against the bare act
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              </Section>
            ) : null}

            <Section title={`TRANSCRIPT (${packet.transcript.length} turns)`}>
              <View style={[s.card, { gap: space.md }]}>
                {packet.transcript.map((turn) => (
                  <View key={turn.index} style={{ gap: 2 }}>
                    <Text style={s.turnHead}>
                      [{turn.index}] {turn.speaker} · {turn.at.slice(11, 19)}
                    </Text>
                    <Text style={s.body} selectable>
                      {turn.text}
                    </Text>
                  </View>
                ))}
              </View>
            </Section>

            {error ? (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={s.footer}>
            <Pressable
              onPress={confirmShare}
              disabled={sharing || deleting}
              style={({ pressed }) => [s.share, pressed && s.sharePressed, sharing && s.shareBusy]}
              accessibilityRole="button"
              accessibilityLabel="Send this packet to a lawyer"
            >
              {sharing ? (
                <ActivityIndicator color={colour.text} />
              ) : (
                <Text style={s.shareText}>Send to a lawyer</Text>
              )}
            </Pressable>

            <Text style={s.footerNote}>
              Leaves this phone only when you send it. Nothing is uploaded automatically.
              {retentionDays !== null
                ? ` The engine keeps this record for ${retentionDays} day${retentionDays === 1 ? "" : "s"} unless you delete it.`
                : " The engine keeps nothing after it restarts."}
            </Text>

            <Pressable
              onPress={confirmDelete}
              disabled={sharing || deleting}
              style={s.delete}
              accessibilityRole="button"
              accessibilityLabel="Permanently delete this record"
            >
              {deleting ? (
                <ActivityIndicator color={colour.unlawful} />
              ) : (
                <Text style={s.deleteText}>Delete this record</Text>
              )}
            </Pressable>
          </View>
        </>
      ) : (
        <View style={s.centre}>
          <Text style={s.centreTitle}>The packet could not be built</Text>
          <Text style={s.centreText}>{error}</Text>
          <Text style={s.centreText}>
            Sessions live in the engine's memory and are lost if it restarts.
          </Text>
          <Pressable onPress={onDone} style={s.fallbackButton} accessibilityRole="button">
            <Text style={s.shareText}>Back to start</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Meta({ packet }: { packet: IncidentPacket }) {
  const rows: Array<[string, string]> = [
    ["session", packet.sessionId],
    ["generated", packet.generatedAt.replace("T", " ").slice(0, 19) + " UTC"],
    ["duration", `${packet.durationSeconds}s`],
    ["turns", String(packet.transcript.length)],
    ["corpus", packet.corpusVersion],
  ];
  return (
    <View style={s.card}>
      {rows.map(([k, v]) => (
        <View key={k} style={s.row}>
          <Text style={s.rowKey}>{k}</Text>
          <Text style={s.rowVal} selectable>
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={s.eyebrow}>{title}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colour.border,
  },
  headerTitle: { color: colour.text, fontSize: type.heading, fontWeight: "700" },
  done: { minHeight: 36, paddingHorizontal: space.md, justifyContent: "center" },
  doneText: { color: colour.action, fontSize: type.body, fontWeight: "700" },

  scroll: { padding: space.lg, gap: space.lg, paddingBottom: space.xl },

  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  centreTitle: { color: colour.text, fontSize: type.heading, fontWeight: "700", textAlign: "center" },
  centreText: { color: colour.textMuted, fontSize: type.label, textAlign: "center", lineHeight: 20 },

  warning: {
    backgroundColor: colour.warnBg,
    borderColor: colour.warn,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  warningTitle: { color: colour.warn, fontSize: type.label, fontWeight: "800", letterSpacing: 0.6 },
  warningBody: { color: colour.text, fontSize: type.small, lineHeight: 18 },

  eyebrow: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.4 },
  card: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  caveat: { color: colour.textFaint, fontSize: type.small, fontStyle: "italic", lineHeight: 17 },
  body: { color: colour.text, fontSize: type.label, lineHeight: 21 },

  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  rowKey: { color: colour.textFaint, fontSize: type.small },
  rowVal: { color: colour.text, fontSize: type.small, fontWeight: "600", flexShrink: 1, textAlign: "right" },

  factLine: { color: colour.text, fontSize: type.label },
  factKey: { fontWeight: "700" },
  evidence: { color: colour.textMuted, fontSize: type.small, lineHeight: 18, fontStyle: "italic" },

  provisionCite: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  provisionSummary: { color: colour.textMuted, fontSize: type.small, lineHeight: 18 },
  provisionUnverified: { color: colour.warn, fontSize: type.small, fontWeight: "600" },

  turnHead: { color: colour.textFaint, fontSize: type.small, fontWeight: "700", letterSpacing: 0.3 },

  errorBox: {
    backgroundColor: colour.unlawfulBg,
    borderColor: colour.unlawful,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  errorText: { color: colour.text, fontSize: type.label, lineHeight: 20 },

  footer: {
    borderTopWidth: 1,
    borderTopColor: colour.border,
    backgroundColor: colour.surface,
    padding: space.md,
    gap: space.sm,
  },
  share: {
    minHeight: TAP_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colour.action,
  },
  sharePressed: { opacity: 0.85 },
  shareBusy: { opacity: 0.7 },
  shareText: { color: colour.text, fontSize: type.body, fontWeight: "700" },
  footerNote: { color: colour.textFaint, fontSize: type.small, textAlign: "center", lineHeight: 16 },
  delete: {
    minHeight: TAP_MIN - 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.unlawful,
  },
  deleteText: { color: colour.unlawful, fontSize: type.label, fontWeight: "700" },

  fallbackButton: {
    minHeight: TAP_MIN,
    paddingHorizontal: space.xl,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colour.action,
    marginTop: space.sm,
  },
});
