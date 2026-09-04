import { useState } from "react";
import {
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
import { isDialable, normalisePhone } from "../contacts/message";
import { newContactId, type TrustedContact } from "../contacts/storage";
import { colour, radius, space, TAP_MIN, type } from "../theme";

/**
 * Trusted contacts (PRD R5).
 *
 * "Contacts are configured during onboarding, before the product is ever
 * needed" — nobody types their sister's number with a constable standing over
 * them. This screen exists to be visited on a quiet afternoon, which is why
 * the start screen nags when it is empty.
 *
 * The name field is not decoration. A message that opens "Someone you know may
 * need help" is markedly less useful to a recipient than one that opens with a
 * name they recognise.
 */
export function ContactsScreen({
  contacts,
  userName,
  onSave,
  onSaveName,
  onClose,
}: {
  contacts: TrustedContact[];
  userName: string | null;
  onSave: (next: TrustedContact[]) => Promise<void>;
  onSaveName: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [who, setWho] = useState(userName ?? "");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const n = name.trim();
    const p = normalisePhone(phone);
    if (n.length === 0) return setError("Give this person a name you will recognise in a hurry.");
    if (!isDialable(p)) return setError("That does not look like a number this phone can message.");
    if (contacts.some((c) => normalisePhone(c.phone) === p)) {
      return setError("That number is already on the list.");
    }
    setError(null);
    await onSave([...contacts, { id: newContactId(), name: n, phone: p }]);
    setName("");
    setPhone("");
  };

  const remove = (c: TrustedContact) => {
    Alert.alert("Remove this contact?", `${c.name} will no longer be alerted.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => void onSave(contacts.filter((x) => x.id !== c.id)),
      },
    ]);
  };

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Trusted contacts</Text>
        <Pressable onPress={onClose} style={s.close} accessibilityRole="button" hitSlop={8}>
          <Text style={s.closeText}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        <Text style={s.intro}>
          One tap during an encounter sends these people where you are and what the app thinks is
          happening. Set them up now — not while it is happening.
        </Text>

        <View style={s.field}>
          <Text style={s.label}>YOUR NAME</Text>
          <TextInput
            style={s.input}
            value={who}
            onChangeText={setWho}
            onBlur={() => void onSaveName(who)}
            placeholder="What your contacts call you"
            placeholderTextColor={colour.textFaint}
            accessibilityLabel="Your name"
          />
          <Text style={s.hint}>
            The alert opens with this, so whoever gets it knows immediately who it is about.
          </Text>
        </View>

        <View style={s.field}>
          <Text style={s.label}>
            {contacts.length > 0 ? `${contacts.length} CONTACT${contacts.length === 1 ? "" : "S"}` : "NO CONTACTS YET"}
          </Text>

          {contacts.map((c) => (
            <View key={c.id} style={s.contact}>
              <View style={s.contactText}>
                <Text style={s.contactName}>{c.name}</Text>
                <Text style={s.contactPhone}>{c.phone}</Text>
              </View>
              <Pressable onPress={() => remove(c)} style={s.remove} accessibilityRole="button" hitSlop={8}>
                <Text style={s.removeText}>Remove</Text>
              </Pressable>
            </View>
          ))}

          {contacts.length === 0 ? (
            <Text style={s.hint}>
              A family member, a friend, a lawyer — anyone who would come and find you.
            </Text>
          ) : null}
        </View>

        <View style={s.field}>
          <Text style={s.label}>ADD SOMEONE</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={colour.textFaint}
            accessibilityLabel="Contact name"
          />
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="Phone number"
            placeholderTextColor={colour.textFaint}
            keyboardType="phone-pad"
            accessibilityLabel="Contact phone number"
          />
          <Pressable onPress={() => void add()} style={s.addButton} accessibilityRole="button">
            <Text style={s.addButtonText}>Add contact</Text>
          </Pressable>
          {error ? <Text style={s.error}>{error}</Text> : null}
        </View>

        {/* The limitation is stated where it can be acted on, not buried in a
            README. A user who believes the alert goes by itself will not check
            that it did. */}
        <View style={s.caveat}>
          <Text style={s.caveatTitle}>How the alert actually goes</Text>
          <Text style={s.caveatBody}>
            Kavach fills in the message and the numbers and opens your messaging app. You still
            have to press send there. It cannot send messages on its own, and it cannot tell you
            whether one arrived.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  close: { minHeight: 36, paddingHorizontal: space.md, justifyContent: "center" },
  closeText: { color: colour.action, fontSize: type.body, fontWeight: "700" },

  scroll: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  intro: { color: colour.textMuted, fontSize: type.label, lineHeight: 21 },

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

  contact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  contactText: { gap: 2, flex: 1 },
  contactName: { color: colour.text, fontSize: type.body, fontWeight: "600" },
  contactPhone: { color: colour.textMuted, fontSize: type.small },
  remove: { paddingHorizontal: space.sm, minHeight: 36, justifyContent: "center" },
  removeText: { color: colour.unlawful, fontSize: type.small, fontWeight: "700" },

  addButton: {
    minHeight: TAP_MIN,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colour.action,
  },
  addButtonText: { color: colour.text, fontSize: type.body, fontWeight: "700" },
  error: { color: colour.unlawful, fontSize: type.small, lineHeight: 18 },

  caveat: {
    backgroundColor: colour.surface,
    borderWidth: 1,
    borderColor: colour.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  caveatTitle: { color: colour.textMuted, fontSize: type.label, fontWeight: "700" },
  caveatBody: { color: colour.textFaint, fontSize: type.small, lineHeight: 18 },
});
