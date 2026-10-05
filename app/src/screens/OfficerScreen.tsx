import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { OfficerFieldPrompt, OfficerRecord } from "../api/types";
import type { OfficerFields } from "../api/client";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * PRD R11 — officer detail capture.
 *
 * The corpus tells the user, in almost every scenario, that the officer's
 * identity is the fact most often missing later. Until this screen existed it
 * said that and gave them nowhere to put it, and the packet's officer section
 * was empty for that reason and no other.
 *
 * ## What this screen is designed around
 *
 * The person using it is standing in front of a police officer, holding their
 * phone, possibly being watched. Everything below follows from that:
 *
 *   · **One field at a time, in usefulness order.** The buckle number is
 *     first because the corpus says it is the most reliable identifier and
 *     the most commonly lost. If they get one field in before they have to
 *     put the phone down, it should be that one.
 *   · **Save is always available.** Nothing is required, no validation blocks
 *     it, and a record with one field is a record. A form that refuses to
 *     save until it is complete is a form that gets abandoned at a roadside.
 *   · **Every prompt comes from the corpus.** The labels, the hints and the
 *     "why this matters" text are engine output rendered verbatim, like every
 *     other string in this app. The client renders; it does not decide.
 *   · **Nothing is inferred.** There is no "we detected a name in the
 *     transcript" affordance and there must never be one. A guessed
 *     attribution in an advocate's packet is worse than a blank, because a
 *     blank is obviously a blank.
 */
export function OfficerScreen({
  intro,
  prompts,
  officers,
  saving,
  error,
  onSave,
  onDelete,
  onClose,
}: {
  /** Corpus text. Rendered verbatim. */
  intro: string;
  prompts: OfficerFieldPrompt[];
  officers: OfficerRecord[];
  saving: boolean;
  error: string | null;
  onSave: (fields: OfficerFields) => Promise<void>;
  onDelete: (officerId: string) => Promise<void>;
  onClose: () => void;
}) {
  const ordered = useMemo(() => [...prompts].sort((a, b) => a.priority - b.priority), [prompts]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const anyContent = Object.values(draft).some((v) => v.trim().length > 0);

  const reset = useCallback(() => {
    setDraft({});
    setEditingId(null);
  }, []);

  const save = useCallback(async () => {
    const fields: OfficerFields = editingId ? { id: editingId } : {};
    for (const p of ordered) {
      const v = draft[p.field];
      // Only fields actually touched are sent, so a correction to one field
      // does not blank the six the user left alone.
      if (v !== undefined) (fields as Record<string, unknown>)[p.field] = v;
    }
    await onSave(fields);
    reset();
  }, [draft, editingId, onSave, ordered, reset]);

  const edit = useCallback((o: OfficerRecord) => {
    const next: Record<string, string> = {};
    for (const key of ["name", "buckleNumber", "rank", "station", "vehicleNumber", "unit", "description"] as const) {
      const v = o[key];
      if (typeof v === "string") next[key] = v;
    }
    setDraft(next);
    setEditingId(o.id);
  }, []);

  const confirmDelete = useCallback(
    (o: OfficerRecord) => {
      Alert.alert(
        "Remove this record?",
        "It is removed from the packet as well. If you only got it slightly wrong, correct it instead.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Remove", style: "destructive", onPress: () => void onDelete(o.id) },
        ],
      );
    },
    [onDelete],
  );

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Who stopped you</Text>
        <Pressable onPress={onClose} style={s.done} accessibilityRole="button" hitSlop={8}>
          <Text style={s.doneText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.intro}>{intro}</Text>

        {officers.length > 0 ? (
          <View style={{ gap: space.sm }}>
            <Text style={s.eyebrow}>RECORDED SO FAR ({officers.length})</Text>
            {officers.map((o, i) => (
              <View key={o.id} style={s.recorded}>
                <Text style={s.recordedTitle}>
                  {o.buckleNumber ? `Buckle ${o.buckleNumber}` : o.name ? o.name : `Officer ${i + 1}`}
                </Text>
                {describe(o).map((line) => (
                  <Text key={line} style={s.recordedLine}>
                    {line}
                  </Text>
                ))}
                <View style={s.recordedActions}>
                  <Pressable onPress={() => edit(o)} style={s.smallButton} accessibilityRole="button">
                    <Text style={s.smallButtonText}>Correct</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => confirmDelete(o)}
                    style={[s.smallButton, s.smallDanger]}
                    accessibilityRole="button"
                  >
                    <Text style={[s.smallButtonText, s.smallDangerText]}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text style={s.eyebrow}>{editingId ? "CORRECTING A RECORD" : "ADD WHAT YOU CAN SEE"}</Text>
          {ordered.map((p) => (
            <View key={p.field} style={s.field}>
              <Text style={s.label}>{p.label}</Text>
              <TextInput
                value={draft[p.field] ?? ""}
                onChangeText={(v) => setDraft((d) => ({ ...d, [p.field]: v }))}
                placeholder={p.hint}
                placeholderTextColor={colour.textFaint}
                style={[s.input, p.field === "description" && s.inputTall]}
                multiline={p.field === "description"}
                keyboardType={p.keyboard === "numeric" ? "numbers-and-punctuation" : "default"}
                autoCapitalize={p.field === "description" ? "sentences" : "characters"}
                autoCorrect={false}
                accessibilityLabel={p.label}
              />
              <Text style={s.why}>{p.why}</Text>
            </View>
          ))}
        </View>

        {error ? (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={s.footer}>
        <Pressable
          onPress={() => void save()}
          disabled={saving || (!anyContent && !editingId)}
          style={({ pressed }) => [
            s.save,
            pressed && s.savePressed,
            (saving || (!anyContent && !editingId)) && s.saveDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={editingId ? "Save the correction" : "Save these officer details"}
        >
          {saving ? (
            <ActivityIndicator color={colour.text} />
          ) : (
            <Text style={s.saveText}>{editingId ? "Save correction" : "Save"}</Text>
          )}
        </Pressable>
        {editingId ? (
          <Pressable onPress={reset} style={s.cancel} accessibilityRole="button">
            <Text style={s.cancelText}>Cancel the correction</Text>
          </Pressable>
        ) : (
          <Text style={s.footerNote}>
            Save whatever you have. One field is a record; you can add more later.
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** One line per field that was actually filled in. */
function describe(o: OfficerRecord): string[] {
  const out: string[] = [];
  if (o.name) out.push(`Name: ${o.name}`);
  if (o.rank) out.push(`Rank: ${o.rank}`);
  if (o.station) out.push(`Station: ${o.station}`);
  if (o.vehicleNumber) out.push(`Vehicle: ${o.vehicleNumber}`);
  if (o.unit) out.push(`Unit: ${o.unit}`);
  if (o.description) out.push(o.description);
  return out;
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
  intro: { color: colour.textMuted, fontSize: type.label, lineHeight: 21 },
  eyebrow: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.4 },

  recorded: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  recordedTitle: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  recordedLine: { color: colour.textMuted, fontSize: type.small, lineHeight: 18 },
  recordedActions: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
  smallButton: {
    minHeight: TAP_MIN - 12,
    paddingHorizontal: space.md,
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.action,
  },
  smallButtonText: { color: colour.action, fontSize: type.small, fontWeight: "700" },
  smallDanger: { borderColor: colour.unlawful },
  smallDangerText: { color: colour.unlawful },

  field: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  label: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  input: {
    minHeight: TAP_MIN,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surfaceRaised,
    color: colour.text,
    fontSize: type.body,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  inputTall: { minHeight: TAP_MIN * 2, textAlignVertical: "top" },
  why: { color: colour.textFaint, fontSize: type.small, lineHeight: 17 },

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
  cancel: { minHeight: TAP_MIN - 10, alignItems: "center", justifyContent: "center" },
  cancelText: { color: colour.textMuted, fontSize: type.label, fontWeight: "600" },
  footerNote: { color: colour.textFaint, fontSize: type.small, textAlign: "center", lineHeight: 16 },
});
