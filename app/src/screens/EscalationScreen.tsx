import * as Clipboard from "expo-clipboard";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { EscalationOption, EscalationResult } from "../api/types";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * PRD R9 — what to do afterwards.
 *
 * "Which authority hears this complaint, the deadline, the required contents,
 * and a draft complaint the user edits."
 *
 * ## What this screen is careful about
 *
 *   · **The draft is editable, and edited locally.** Nothing typed here is
 *     sent anywhere. The complaint is the user's document, they sign it, and
 *     the app's job ends at handing them a starting point.
 *   · **Blanks are counted and named.** The engine reports every placeholder
 *     it could not fill, and this shows that count above the draft. A
 *     plausible-looking letter with a silent hole in it is worse than an
 *     obviously incomplete one.
 *   · **Withheld routes are shown, not hidden.** When the output guard
 *     refuses a route, the user is told a route was withheld and why. A route
 *     that vanishes silently reads as "the corpus has nothing", when what it
 *     actually means is that the corpus has a defect someone must fix.
 *   · **The unverified banner is first.** Every deadline and every authority
 *     on this screen is a placeholder no advocate has read.
 */
export function EscalationScreen({
  result,
  loading,
  error,
  onRetry,
  onClose,
}: {
  result: EscalationResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.headerTitle}>What you can do next</Text>
        <Pressable onPress={onClose} style={s.done} accessibilityRole="button" hitSlop={8}>
          <Text style={s.doneText}>Done</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.centre}>
          <ActivityIndicator color={colour.text} />
          <Text style={s.centreText}>Working out which routes apply…</Text>
        </View>
      ) : result ? (
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          {result.guidance.unverifiedContentWarning ? (
            <View style={s.warning}>
              <Text style={s.warningTitle}>UNVERIFIED CONTENT — NOT FOR FILING</Text>
              <Text style={s.warningBody}>{result.guidance.unverifiedContentWarning}</Text>
            </View>
          ) : null}

          <Text style={s.disclaimer}>{result.guidance.disclaimer}</Text>

          {result.withheld.length > 0 ? (
            <View style={s.withheld}>
              <Text style={s.withheldTitle}>
                {result.withheld.length} route{result.withheld.length === 1 ? " was" : "s were"} withheld
              </Text>
              <Text style={s.withheldBody}>
                The output guard refused {result.withheld.length === 1 ? "it" : "them"} rather than showing
                you something the corpus got wrong. This is a defect to report, not something you did.
              </Text>
              {result.withheld.map((w) => (
                <Text key={w.routeId} style={s.withheldDetail}>
                  {w.routeId}: {w.violations.map((v) => v.kind).join(", ")}
                </Text>
              ))}
            </View>
          ) : null}

          {result.guidance.options.length === 0 ? (
            <View style={s.card}>
              <Text style={s.body}>
                No route in this corpus matches this session. That is a gap in the corpus, not a
                statement that nothing can be done.
              </Text>
            </View>
          ) : (
            result.guidance.options.map((o, i) => <Route key={o.route.id} option={o} index={i + 1} />)
          )}
        </ScrollView>
      ) : (
        <View style={s.centre}>
          <Text style={s.centreTitle}>Could not load the routes</Text>
          <Text style={s.centreText}>{error}</Text>
          <Pressable onPress={onRetry} style={s.retry} accessibilityRole="button">
            <Text style={s.retryText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Route({ option, index }: { option: EscalationOption; index: number }) {
  const [expanded, setExpanded] = useState(index === 1);
  // The draft is the user's document from the moment it is on screen. Edits
  // live here and go nowhere near the engine.
  const [draft, setDraft] = useState(option.draft);
  const [busy, setBusy] = useState<null | "copy" | "share">(null);
  const [note, setNote] = useState<string | null>(null);

  const copy = useCallback(async () => {
    setBusy("copy");
    try {
      await Clipboard.setStringAsync(draft);
      setNote("Copied. Paste it into an email or a document.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [draft]);

  const share = useCallback(async () => {
    setBusy("share");
    setNote(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setNote("This device has no way to share a file.");
        return;
      }
      const file = new File(Paths.cache, `kavach-complaint-${option.route.id}.txt`);
      file.write(draft);
      await Sharing.shareAsync(file.uri, { mimeType: "text/plain", dialogTitle: "Send the draft" });
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [draft, option.route.id]);

  return (
    <View style={s.route}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={s.routeHead}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={s.routeTitle}>
            {index}. {option.route.title}
          </Text>
          <Text style={s.routeWhy}>{option.because.join(" · ")}</Text>
        </View>
        <Text style={s.chevron}>{expanded ? "−" : "+"}</Text>
      </Pressable>

      {expanded ? (
        <View style={s.routeBody}>
          <Field label="WHO HEARS IT">
            <Text style={s.body}>{option.route.authority.name}</Text>
            <Text style={s.muted}>{option.route.authority.remit}</Text>
            {option.route.authority.howToReach.map((h) => (
              <Text key={h} style={s.bullet}>
                • {h}
              </Text>
            ))}
          </Field>

          <Field label="DEADLINE">
            <Text style={s.body}>{option.route.deadline.text}</Text>
          </Field>

          <Field label="WHAT IT HAS TO CONTAIN">
            {option.route.requiredContents.map((c) => (
              <Text key={c} style={s.bullet}>
                • {c}
              </Text>
            ))}
          </Field>

          <Field label="WATCH OUT FOR">
            {option.route.cautions.map((c) => (
              <Text key={c} style={s.bullet}>
                • {c}
              </Text>
            ))}
          </Field>

          {option.provisions.length > 0 ? (
            <Field label="PROVISIONS REFERENCED">
              {option.provisions.map((p) => (
                <Text key={p.id} style={s.muted}>
                  {p.act} {p.section} — {p.summary}
                </Text>
              ))}
            </Field>
          ) : null}

          <Field label="DRAFT — EDIT IT BEFORE YOU SEND IT">
            {option.unfilled.length > 0 ? (
              <Text style={s.blanks}>
                {option.unfilled.length} blank{option.unfilled.length === 1 ? "" : "s"} only you can fill.
                They appear below as lines of underscores.
              </Text>
            ) : null}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              style={s.draft}
              accessibilityLabel="Draft complaint, editable"
            />
            <View style={s.actions}>
              <Pressable
                onPress={() => void copy()}
                disabled={busy !== null}
                style={({ pressed }) => [s.action, pressed && s.actionPressed]}
                accessibilityRole="button"
              >
                <Text style={s.actionText}>{busy === "copy" ? "Copying…" : "Copy"}</Text>
              </Pressable>
              <Pressable
                onPress={() => void share()}
                disabled={busy !== null}
                style={({ pressed }) => [s.action, pressed && s.actionPressed]}
                accessibilityRole="button"
              >
                <Text style={s.actionText}>{busy === "share" ? "Sharing…" : "Share as a file"}</Text>
              </Pressable>
            </View>
            {note ? <Text style={s.note}>{note}</Text> : null}
          </Field>
        </View>
      ) : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={s.eyebrow}>{label}</Text>
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

  scroll: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
  centreTitle: { color: colour.text, fontSize: type.heading, fontWeight: "700", textAlign: "center" },
  centreText: { color: colour.textMuted, fontSize: type.label, textAlign: "center", lineHeight: 20 },
  retry: {
    minHeight: TAP_MIN,
    paddingHorizontal: space.xl,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colour.action,
  },
  retryText: { color: colour.text, fontSize: type.body, fontWeight: "700" },

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
  disclaimer: { color: colour.textFaint, fontSize: type.small, lineHeight: 17 },

  withheld: {
    backgroundColor: colour.unlawfulBg,
    borderColor: colour.unlawful,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  withheldTitle: { color: colour.unlawful, fontSize: type.label, fontWeight: "800" },
  withheldBody: { color: colour.text, fontSize: type.small, lineHeight: 18 },
  withheldDetail: { color: colour.textMuted, fontSize: type.small },

  card: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  route: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  routeHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    minHeight: TAP_MIN,
  },
  routeTitle: { color: colour.text, fontSize: type.label, fontWeight: "700", lineHeight: 20 },
  routeWhy: { color: colour.textFaint, fontSize: type.small },
  chevron: { color: colour.textMuted, fontSize: type.heading, fontWeight: "700", width: 20, textAlign: "center" },
  routeBody: {
    padding: space.md,
    paddingTop: 0,
    gap: space.md,
    borderTopWidth: 1,
    borderTopColor: colour.border,
  },

  eyebrow: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.2 },
  body: { color: colour.text, fontSize: type.label, lineHeight: 21 },
  muted: { color: colour.textMuted, fontSize: type.small, lineHeight: 18 },
  bullet: { color: colour.textMuted, fontSize: type.small, lineHeight: 19 },
  blanks: { color: colour.warn, fontSize: type.small, lineHeight: 17, fontWeight: "600" },

  draft: {
    minHeight: 260,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surfaceRaised,
    color: colour.text,
    fontSize: type.small,
    lineHeight: 19,
    padding: space.md,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", gap: space.sm },
  action: {
    flex: 1,
    minHeight: TAP_MIN - 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.action,
  },
  actionPressed: { opacity: 0.8 },
  actionText: { color: colour.action, fontSize: type.label, fontWeight: "700" },
  note: { color: colour.textFaint, fontSize: type.small, lineHeight: 17 },
});
