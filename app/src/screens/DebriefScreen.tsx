import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { DebriefQuestion, DebriefResponse } from "../api/types";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * PRD R13 — the post-incident debrief.
 *
 * "Structured questions within 24 hours while memory is fresh, appended to
 * the packet."
 *
 * ## What this screen is not
 *
 * It is not a re-engagement loop. There is no streak, no reminder cadence
 * beyond the one window, and nothing here is counted as usage.
 * CLAUDE.md invariant 7: success is a product people open rarely.
 *
 * ## What the window means here
 *
 * The countdown is shown because memory genuinely decays and an advocate
 * reading the packet is entitled to know when an answer was given. It is not
 * a lockout: once it closes, the form still works, answers are still kept,
 * and they are marked as late in the packet rather than discarded. Throwing
 * away someone's only account of an encounter to protect a property of that
 * account would be the wrong trade in both directions.
 *
 * Every question, and every "why we ask" line, is corpus text rendered
 * verbatim. The client renders; it does not decide what is worth asking.
 */
export function DebriefScreen({
  data,
  loading,
  saving,
  error,
  onSubmit,
  onRetry,
  onClose,
}: {
  data: DebriefResponse | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onSubmit: (answers: Record<string, string>) => Promise<void>;
  onRetry: () => void;
  onClose: () => void;
}) {
  const existing = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of data?.answers ?? []) m[a.questionId] = a.value;
    return m;
  }, [data]);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const value = (id: string) => draft[id] ?? existing[id] ?? "";
  const dirty = Object.keys(draft).length > 0;

  const submit = useCallback(async () => {
    await onSubmit(draft);
    setDraft({});
  }, [draft, onSubmit]);

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <Text style={s.headerTitle}>While you remember it</Text>
        <Pressable onPress={onClose} style={s.done} accessibilityRole="button" hitSlop={8}>
          <Text style={s.doneText}>Done</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={s.centre}>
          <ActivityIndicator color={colour.text} />
        </View>
      ) : data ? (
        <>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
            <Text style={s.intro}>{data.intro}</Text>

            <View style={data.window.open ? s.windowOpen : s.windowClosed}>
              <Text style={data.window.open ? s.windowOpenText : s.windowClosedText}>
                {data.window.open
                  ? `${formatHours(data.window.hoursRemaining)} left in the 24-hour window`
                  : "The 24-hour window has closed"}
              </Text>
              <Text style={s.windowNote}>
                {data.window.open
                  ? "Answers given now are marked as fresh in the packet."
                  : "Answers are still kept and still go into the packet — they are marked as given after the window, so whoever reads it can weigh them."}
              </Text>
            </View>

            {data.questions.map((q) => (
              <Question
                key={q.id}
                question={q}
                value={value(q.id)}
                answeredAt={data.answers.find((a) => a.questionId === q.id)?.answeredAt ?? null}
                onChange={(v) => setDraft((d) => ({ ...d, [q.id]: v }))}
              />
            ))}

            {error ? (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={s.footer}>
            <Pressable
              onPress={() => void submit()}
              disabled={saving || !dirty}
              style={({ pressed }) => [s.save, pressed && s.savePressed, (saving || !dirty) && s.saveDisabled]}
              accessibilityRole="button"
              accessibilityLabel="Save these answers into the packet"
            >
              {saving ? <ActivityIndicator color={colour.text} /> : <Text style={s.saveText}>Save answers</Text>}
            </Pressable>
            <Text style={s.footerNote}>
              Answers go into the packet a lawyer reads. Leave anything blank. Clearing an answer removes it.
            </Text>
          </View>
        </>
      ) : (
        <View style={s.centre}>
          <Text style={s.centreTitle}>Could not load the questions</Text>
          <Text style={s.centreText}>{error}</Text>
          <Pressable onPress={onRetry} style={s.retry} accessibilityRole="button">
            <Text style={s.saveText}>Try again</Text>
          </Pressable>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

function Question({
  question,
  value,
  answeredAt,
  onChange,
}: {
  question: DebriefQuestion;
  value: string;
  answeredAt: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <View style={s.card}>
      <Text style={s.prompt}>
        {question.prompt}
        {question.optional ? <Text style={s.optional}> · optional</Text> : null}
      </Text>

      {question.kind === "choice" && question.choices ? (
        <View style={s.choices}>
          {question.choices.map((c) => {
            const selected = value === c;
            return (
              <Pressable
                key={c}
                onPress={() => onChange(selected ? "" : c)}
                style={({ pressed }) => [s.choice, selected && s.choiceOn, pressed && s.choicePressed]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[s.choiceText, selected && s.choiceTextOn]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : question.kind === "yesno" ? (
        <View style={s.choices}>
          {["Yes", "No"].map((c) => {
            const selected = value === c;
            return (
              <Pressable
                key={c}
                onPress={() => onChange(selected ? "" : c)}
                style={({ pressed }) => [s.choice, selected && s.choiceOn, pressed && s.choicePressed]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text style={[s.choiceText, selected && s.choiceTextOn]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChange}
          multiline
          placeholder="Type what you remember"
          placeholderTextColor={colour.textFaint}
          style={s.input}
          accessibilityLabel={question.prompt}
        />
      )}

      <Text style={s.why}>{question.why}</Text>
      {answeredAt ? <Text style={s.answered}>saved {answeredAt.replace("T", " ").slice(0, 16)} UTC</Text> : null}
    </View>
  );
}

function formatHours(h: number): string {
  if (h >= 2) return `${Math.floor(h)} hours`;
  const mins = Math.max(1, Math.round(h * 60));
  return `${mins} minute${mins === 1 ? "" : "s"}`;
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
  intro: { color: colour.textMuted, fontSize: type.label, lineHeight: 21 },

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

  windowOpen: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.safest,
    backgroundColor: colour.safestBg,
    padding: space.md,
    gap: space.xs,
  },
  windowClosed: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surface,
    padding: space.md,
    gap: space.xs,
  },
  windowOpenText: { color: colour.safest, fontSize: type.label, fontWeight: "700" },
  windowClosedText: { color: colour.textMuted, fontSize: type.label, fontWeight: "700" },
  windowNote: { color: colour.textFaint, fontSize: type.small, lineHeight: 17 },

  card: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  prompt: { color: colour.text, fontSize: type.label, fontWeight: "700", lineHeight: 20 },
  optional: { color: colour.textFaint, fontWeight: "400" },
  why: { color: colour.textFaint, fontSize: type.small, lineHeight: 17 },
  answered: { color: colour.textFaint, fontSize: type.small, fontStyle: "italic" },

  choices: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  choice: {
    minHeight: TAP_MIN - 12,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surfaceRaised,
  },
  choicePressed: { opacity: 0.8 },
  choiceOn: { borderColor: colour.action, backgroundColor: colour.infoBg },
  choiceText: { color: colour.textMuted, fontSize: type.small, fontWeight: "600" },
  choiceTextOn: { color: colour.text },

  input: {
    minHeight: TAP_MIN * 1.6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surfaceRaised,
    color: colour.text,
    fontSize: type.label,
    lineHeight: 20,
    padding: space.md,
    textAlignVertical: "top",
  },

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
  save: {
    minHeight: TAP_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colour.action,
  },
  savePressed: { opacity: 0.85 },
  saveDisabled: { opacity: 0.5 },
  saveText: { color: colour.text, fontSize: type.body, fontWeight: "700" },
  footerNote: { color: colour.textFaint, fontSize: type.small, textAlign: "center", lineHeight: 16 },
});
