import { useState } from "react";
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
import { getHealth } from "../api/client";
import { defaultBaseUrl, describeDefaultSource, normalise } from "../api/config";
import type { Health } from "../api/types";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * Where the engine lives.
 *
 * This exists because the engine runs on a laptop whose IP changes, and a
 * phone that cannot reach it should be able to say so and be fixed in ten
 * seconds rather than a rebuild. The probe button matters as much as the
 * field: it separates "wrong address" from "engine is not running", which are
 * otherwise the same silent failure.
 */
export function SettingsScreen({
  baseUrl,
  sttUrl,
  apiKey,
  onSaveApiKey,
  onSave,
  onReset,
  onClose,
}: {
  baseUrl: string;
  /** Derived from the engine host, shown so a speech failure is diagnosable. */
  sttUrl: string | null;
  /** Instance key. Needed to start a session or read the corpus. */
  apiKey: string | null;
  onSaveApiKey: (key: string) => Promise<void>;
  onSave: (url: string) => Promise<void>;
  onReset: () => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(baseUrl);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<Health | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [key, setKey] = useState(apiKey ?? "");
  const [keySaved, setKeySaved] = useState(false);

  const probe = async () => {
    setProbing(true);
    setProbeResult(null);
    setProbeError(null);
    try {
      setProbeResult(await getHealth(normalise(draft)));
    } catch (e) {
      setProbeError((e as Error).message);
    } finally {
      setProbing(false);
    }
  };

  const save = async () => {
    await onSave(normalise(draft));
    setSaved(true);
  };

  const reset = async () => {
    await onReset();
    setDraft(defaultBaseUrl());
    setProbeResult(null);
    setProbeError(null);
    setSaved(false);
  };

  return (
    <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Engine address</Text>
        <Pressable onPress={onClose} style={s.closeButton} accessibilityRole="button" hitSlop={8}>
          <Text style={s.closeText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <View style={s.field}>
          <Text style={s.label}>BASE URL</Text>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={(t) => {
              setDraft(t);
              setSaved(false);
            }}
            placeholder={defaultBaseUrl()}
            placeholderTextColor={colour.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="Engine base URL"
          />
          <Text style={s.hint}>
            Default is {defaultBaseUrl()} — {describeDefaultSource()}. Start the engine with{" "}
            <Text style={s.mono}>npm run dev</Text> in kavach-engine, and make sure the phone is on
            the same network.
          </Text>
        </View>

        <View style={s.buttonRow}>
          <Pressable onPress={probe} disabled={probing} style={[s.button, s.buttonSecondary]} accessibilityRole="button">
            {probing ? <ActivityIndicator color={colour.text} /> : <Text style={s.buttonText}>Test connection</Text>}
          </Pressable>
          <Pressable onPress={save} style={[s.button, s.buttonPrimary]} accessibilityRole="button">
            <Text style={s.buttonText}>{saved ? "Saved" : "Save"}</Text>
          </Pressable>
        </View>

        {/* PRD R1 forbids a login and there is not one — this is a
            deployment credential typed once, not a user account. Without it
            the services refuse to start a session at all. */}
        <View style={s.field}>
          <Text style={s.label}>ACCESS KEY</Text>
          <TextInput
            style={s.input}
            value={key}
            onChangeText={(t) => {
              setKey(t);
              setKeySaved(false);
            }}
            placeholder="Printed by the engine on first boot"
            placeholderTextColor={colour.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel="Access key"
          />
          <Pressable
            onPress={async () => {
              await onSaveApiKey(key);
              setKeySaved(true);
            }}
            style={[s.button, s.buttonSecondary]}
            accessibilityRole="button"
          >
            <Text style={s.buttonText}>{keySaved ? "Key saved" : "Save key"}</Text>
          </Pressable>
          <Text style={s.hint}>
            Shared by all three services. Look for <Text style={s.mono}>.kavach-secrets.json</Text>{" "}
            in the project root, or set <Text style={s.mono}>KAVACH_API_KEY</Text>. Without it the
            engine will not start a session.
          </Text>
        </View>

        {sttUrl ? (
          <View style={s.field}>
            <Text style={s.label}>SPEECH SERVICE</Text>
            <Text style={s.hint}>
              <Text style={s.mono}>{sttUrl}</Text> — same host as the engine, port 8788. Start it
              with <Text style={s.mono}>npm run dev</Text> in stt-service. It is optional: without
              it the microphone is disabled and typing still works.
            </Text>
          </View>
        ) : null}

        {probeResult ? <ProbeSuccess health={probeResult} /> : null}
        {probeError ? (
          <View style={s.probeFail}>
            <Text style={s.probeFailText}>{probeError}</Text>
          </View>
        ) : null}

        <Pressable onPress={reset} style={s.resetButton} accessibilityRole="button">
          <Text style={s.resetText}>Reset to default</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ProbeSuccess({ health }: { health: Health }) {
  const signedOff = health.corpusStatus === "counsel-signed-off";
  return (
    <View style={s.probeOk}>
      <Text style={s.probeOkTitle}>Engine reachable</Text>
      <Row k="provider" v={health.provider} />
      <Row k="corpus" v={health.corpusVersion} />
      <Row k="status" v={health.corpusStatus} warn={!signedOff} />
      <Row k="content" v={`${health.scenarios} scenarios · ${health.rules} rules`} />
    </View>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowKey}>{k}</Text>
      <Text style={[s.rowVal, warn && s.rowValWarn]}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
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
  closeButton: { minHeight: 36, paddingHorizontal: space.md, justifyContent: "center" },
  closeText: { color: colour.action, fontSize: type.body, fontWeight: "700" },

  scroll: { padding: space.lg, gap: space.lg },

  field: { gap: space.sm },
  label: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.4 },
  input: {
    minHeight: TAP_MIN,
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colour.text,
    fontSize: type.body,
  },
  hint: { color: colour.textFaint, fontSize: type.small, lineHeight: 18 },
  mono: { color: colour.textMuted, fontWeight: "700" },

  buttonRow: { flexDirection: "row", gap: space.sm },
  button: {
    flex: 1,
    minHeight: TAP_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
  },
  buttonPrimary: { backgroundColor: colour.action, borderColor: colour.action },
  buttonSecondary: { backgroundColor: colour.surface, borderColor: colour.border },
  buttonText: { color: colour.text, fontSize: type.body, fontWeight: "700" },

  probeOk: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.safest,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  probeOkTitle: { color: colour.safest, fontSize: type.label, fontWeight: "800", marginBottom: space.xs },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  rowKey: { color: colour.textFaint, fontSize: type.small },
  rowVal: { color: colour.text, fontSize: type.small, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  rowValWarn: { color: colour.warn },

  probeFail: {
    backgroundColor: colour.unlawfulBg,
    borderWidth: 1,
    borderColor: colour.unlawful,
    borderRadius: radius.md,
    padding: space.md,
  },
  probeFailText: { color: colour.text, fontSize: type.label, lineHeight: 20 },

  resetButton: { minHeight: TAP_MIN, alignItems: "center", justifyContent: "center" },
  resetText: { color: colour.textMuted, fontSize: type.label, fontWeight: "600" },
});
