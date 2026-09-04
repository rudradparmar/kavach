import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Trusted contacts, and the name the user goes by.
 *
 * PRD R5 is explicit that these are "configured during onboarding, before the
 * product is ever needed". Nobody types their sister's number while a
 * constable is standing over them, so the start screen nags for this when it
 * is empty and the alert button says plainly that it has nowhere to send.
 */

const CONTACTS_KEY = "kavach.contacts.v1";
const NAME_KEY = "kavach.userName";

export interface TrustedContact {
  id: string;
  name: string;
  phone: string;
}

export async function loadContacts(): Promise<TrustedContact[]> {
  try {
    const raw = await AsyncStorage.getItem(CONTACTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrustedContact[];
    if (!Array.isArray(parsed)) return [];
    // A half-written entry would produce an alert addressed to nobody.
    return parsed.filter(
      (c) => typeof c?.id === "string" && typeof c?.name === "string" && typeof c?.phone === "string",
    );
  } catch {
    return [];
  }
}

export async function saveContacts(contacts: TrustedContact[]): Promise<void> {
  await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(contacts));
}

export async function loadUserName(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(NAME_KEY);
    return v && v.trim().length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function saveUserName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    await AsyncStorage.removeItem(NAME_KEY);
    return;
  }
  await AsyncStorage.setItem(NAME_KEY, trimmed);
}

/** Stable enough for a list that lives on one device. */
export function newContactId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}
