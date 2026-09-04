import * as SMS from "expo-sms";
import { Share } from "react-native";
import type { TrustedContact } from "./storage";

/**
 * Getting the alert out (PRD R5).
 *
 * R5 asks for "delivery via at least two independent channels (SMS + data) to
 * survive network conditions", and both are here: SMS rides the cellular
 * network, the share sheet reaches WhatsApp, Signal, email or anything else
 * installed, over data. When one network is down the other usually is not,
 * which is the property R5 is actually after.
 *
 * **What is not here, and cannot be from inside Expo Go.** `expo-sms` does not
 * send. It opens the platform composer with the message and the numbers filled
 * in, and a human taps send — and on Android the result is always `unknown`,
 * so there is no delivery confirmation either. The same is true of the share
 * sheet.
 *
 * That gap matters and is not papered over anywhere in the UI: R5's "one tap
 * sends" and the ≥98% delivery-receipt metric both need a server-side sender
 * with real credentials, which is deliberately out of scope. What ships is
 * one tap to a prefilled composer, which is the honest version of the feature
 * rather than a mock of the real one.
 */

export type Channel = "sms" | "data";

export interface DispatchResult {
  channel: Channel;
  /** "sent" only where the platform actually says so — Android never does. */
  outcome: "sent" | "dismissed" | "unavailable" | "failed" | "handed-off";
  detail?: string;
}

export async function sendViaSms(
  contacts: TrustedContact[],
  message: string,
): Promise<DispatchResult> {
  if (contacts.length === 0) {
    return { channel: "sms", outcome: "unavailable", detail: "no contacts configured" };
  }
  try {
    if (!(await SMS.isAvailableAsync())) {
      return { channel: "sms", outcome: "unavailable", detail: "this device cannot send SMS" };
    }
    const { result } = await SMS.sendSMSAsync(
      contacts.map((c) => c.phone),
      message,
    );
    if (result === "sent") return { channel: "sms", outcome: "sent" };
    if (result === "cancelled") return { channel: "sms", outcome: "dismissed" };
    // Android always lands here. The composer opened; what happened next is
    // not something the app can see, and claiming otherwise would be a lie
    // the user might rely on.
    return { channel: "sms", outcome: "handed-off", detail: "the SMS app was opened" };
  } catch (e) {
    return { channel: "sms", outcome: "failed", detail: (e as Error).message };
  }
}

export async function sendViaData(message: string): Promise<DispatchResult> {
  try {
    const res = await Share.share({ message });
    if (res.action === Share.dismissedAction) {
      return { channel: "data", outcome: "dismissed" };
    }
    return { channel: "data", outcome: "handed-off", detail: "passed to another app" };
  } catch (e) {
    return { channel: "data", outcome: "failed", detail: (e as Error).message };
  }
}

/** How to describe an outcome without overstating it. */
export function describeOutcome(r: DispatchResult): string {
  const channel = r.channel === "sms" ? "SMS" : "Message";
  switch (r.outcome) {
    case "sent":
      return `${channel}: sent`;
    case "handed-off":
      return `${channel}: handed to your ${r.channel === "sms" ? "messages app" : "chosen app"} — check it actually went`;
    case "dismissed":
      return `${channel}: you closed it without sending`;
    case "unavailable":
      return `${channel}: unavailable${r.detail ? ` — ${r.detail}` : ""}`;
    case "failed":
      return `${channel}: failed${r.detail ? ` — ${r.detail}` : ""}`;
  }
}
