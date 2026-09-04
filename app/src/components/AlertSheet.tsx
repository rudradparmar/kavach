import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DispatchResult } from "../contacts/send";
import { describeOutcome } from "../contacts/send";
import type { TrustedContact } from "../contacts/storage";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * The trusted-contact alert (PRD R5).
 *
 * The message is shown before it goes anywhere. That is a deliberate cost: R5
 * says "one tap sends", and this is one tap to a screen where the user can see
 * exactly what their sister is about to read, including their location. The
 * alternative — firing off a location fix and a police-encounter summary with
 * no preview — is a thing you cannot take back, decided by someone who is
 * frightened and not reading carefully.
 *
 * Both channels are offered side by side rather than in sequence, because
 * which one works depends on which network is up, and the user is the only one
 * who knows whether they have signal or data.
 */
export function AlertSheet({
  visible,
  contacts,
  message,
  preparing,
  results,
  onSendSms,
  onSendData,
  onClose,
  onConfigure,
}: {
  visible: boolean;
  contacts: TrustedContact[];
  message: string | null;
  preparing: boolean;
  results: DispatchResult[];
  onSendSms: () => void;
  onSendData: () => void;
  onClose: () => void;
  onConfigure: () => void;
}) {
  const hasContacts = contacts.length > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>Alert your contacts</Text>
            <Pressable onPress={onClose} style={s.close} accessibilityRole="button" hitSlop={10}>
              <Text style={s.closeText}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={s.body}>
            {!hasContacts ? (
              <View style={s.empty}>
                <Text style={s.emptyTitle}>No trusted contacts yet</Text>
                <Text style={s.emptyBody}>
                  There is nobody to send this to. You can still send it yourself by choosing an
                  app, but it is worth setting contacts up before you need them.
                </Text>
                <Pressable onPress={onConfigure} style={s.secondary} accessibilityRole="button">
                  <Text style={s.secondaryText}>Set up contacts</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={s.to}>
                To: {contacts.map((c) => c.name).join(", ")}
              </Text>
            )}

            {preparing ? (
              <View style={s.preparing}>
                <ActivityIndicator color={colour.text} />
                <Text style={s.preparingText}>Finding where you are…</Text>
              </View>
            ) : message ? (
              <View style={s.preview}>
                <Text style={s.previewLabel}>THEY WILL SEE</Text>
                <Text style={s.previewText} selectable>
                  {message}
                </Text>
              </View>
            ) : null}

            {results.length > 0 ? (
              <View style={s.results}>
                {results.map((r, i) => (
                  <Text key={i} style={s.resultLine}>
                    {describeOutcome(r)}
                  </Text>
                ))}
              </View>
            ) : null}
          </ScrollView>

          <View style={s.footer}>
            <View style={s.channels}>
              <Pressable
                onPress={onSendSms}
                disabled={preparing || !message || !hasContacts}
                style={({ pressed }) => [
                  s.channel,
                  s.channelPrimary,
                  (preparing || !message || !hasContacts) && s.channelDisabled,
                  pressed && s.channelPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send by SMS"
              >
                <Text style={s.channelText}>Send by SMS</Text>
                <Text style={s.channelSub}>works without data</Text>
              </Pressable>

              <Pressable
                onPress={onSendData}
                disabled={preparing || !message}
                style={({ pressed }) => [
                  s.channel,
                  (preparing || !message) && s.channelDisabled,
                  pressed && s.channelPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Send through another app"
              >
                <Text style={s.channelText}>Another app</Text>
                <Text style={s.channelSub}>WhatsApp, email…</Text>
              </Pressable>
            </View>

            {/* Said at the moment of sending, not only in settings. A user who
                thinks this went by itself will not check that it did. */}
            <Text style={s.note}>
              Your messaging app opens with this ready to go — you still have to press send there.
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colour.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: colour.border,
    maxHeight: "88%",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: space.lg,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colour.border,
  },
  title: { color: colour.text, fontSize: type.heading, fontWeight: "700" },
  close: { minHeight: 36, paddingHorizontal: space.sm, justifyContent: "center" },
  closeText: { color: colour.action, fontSize: type.body, fontWeight: "700" },

  body: { padding: space.lg, gap: space.md },
  to: { color: colour.textMuted, fontSize: type.label },

  empty: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  emptyTitle: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  emptyBody: { color: colour.textMuted, fontSize: type.small, lineHeight: 18 },
  secondary: {
    minHeight: TAP_MIN - 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colour.action,
  },
  secondaryText: { color: colour.text, fontSize: type.label, fontWeight: "700" },

  preparing: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  preparingText: { color: colour.textMuted, fontSize: type.label },

  preview: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  previewLabel: { color: colour.textFaint, fontSize: type.small, fontWeight: "800", letterSpacing: 1.4 },
  previewText: { color: colour.text, fontSize: type.label, lineHeight: 21 },

  results: { gap: 2 },
  resultLine: { color: colour.textMuted, fontSize: type.small, lineHeight: 18 },

  footer: {
    borderTopWidth: 1,
    borderTopColor: colour.border,
    backgroundColor: colour.surface,
    padding: space.md,
    gap: space.sm,
  },
  channels: { flexDirection: "row", gap: space.sm },
  channel: {
    flex: 1,
    minHeight: TAP_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colour.border,
    backgroundColor: colour.surfaceRaised,
    gap: 1,
  },
  channelPrimary: { backgroundColor: colour.action, borderColor: colour.action },
  channelPressed: { opacity: 0.85 },
  channelDisabled: { opacity: 0.45 },
  channelText: { color: colour.text, fontSize: type.label, fontWeight: "700" },
  channelSub: { color: colour.textMuted, fontSize: type.small },
  note: { color: colour.textFaint, fontSize: type.small, textAlign: "center", lineHeight: 16 },
});
