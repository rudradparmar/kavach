/**
 * What a trusted contact actually receives.
 *
 * Pure, so `scripts/units.ts` can hold it to the rules below without a device.
 * That matters more here than in most places: this text goes to a third party
 * who was not present, may forward it, and may read it out to the officer.
 *
 * Three rules govern every word of it.
 *
 * **1. It states no law.** CLAUDE.md's first invariant is that nothing in this
 * product authors a legal claim, and the corpus it would be quoting is
 * unverified placeholder text. So the message carries no provision, no section
 * number, and none of the misconduct flags — not even the UNLAWFUL ones. "The
 * police are acting illegally", forwarded around or shown to the officer, is a
 * claim this app cannot stand behind and the user would be left holding.
 *
 * **2. The classification is offered as a guess, not a fact.** The scenario is
 * the engine's reading of a transcript and it can be wrong — that is why there
 * is a confidence floor at all. Telling somebody's sister "the officer took his
 * keys" when the engine misheard is misinformation with real consequences, so
 * the line is attributed rather than asserted.
 *
 * **3. It assumes zero context and no app install** (PRD R5). The recipient may
 * have never heard of any of this. No jargon, no session link that needs an
 * account, and a map URL any phone can open.
 */

export interface AlertLocation {
  latitude: number;
  longitude: number;
  /** Metres. Null when the platform did not report it. */
  accuracyM: number | null;
  at: Date;
}

export interface AlertInput {
  /** What the user calls themselves. Null if they never set one. */
  userName: string | null;
  /** Corpus scenario title, or null when the engine was not confident. */
  scenarioTitle: string | null;
  at: Date;
  location: AlertLocation | null;
  /** Why there is no location, in words a non-technical reader can use. */
  locationProblem: string | null;
  /** Short session reference so a lawyer can tie this to the packet. */
  sessionRef: string;
}

/** A link any phone opens without installing anything. */
export function mapsUrl(latitude: number, longitude: number): string {
  return `https://maps.google.com/?q=${latitude.toFixed(5)},${longitude.toFixed(5)}`;
}

const time = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const date = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function composeAlert(input: AlertInput): string {
  const who = input.userName?.trim() || "Someone you know";
  const lines: string[] = [];

  lines.push(`${who} may need help.`);
  lines.push("");
  lines.push("Automatic message from an app called Kavach. You do not need to install anything.");
  lines.push("");
  lines.push(`They were stopped by police at ${time(input.at)} on ${date(input.at)}.`);

  // Attributed, never asserted — see rule 2 above.
  if (input.scenarioTitle) {
    lines.push(`What the app thinks is happening (it may be wrong): ${input.scenarioTitle}`);
  } else {
    lines.push("The app could not work out what kind of stop this is.");
  }

  lines.push("");
  if (input.location) {
    const accuracy =
      input.location.accuracyM !== null
        ? ` (to about ${Math.round(input.location.accuracyM)} m)`
        : "";
    lines.push(`Where they were at ${time(input.location.at)}${accuracy}:`);
    lines.push(mapsUrl(input.location.latitude, input.location.longitude));
  } else {
    // Silence would read as "no location was needed". Say what went wrong.
    lines.push(`Location not available — ${input.locationProblem ?? "the phone could not get a fix"}.`);
  }

  lines.push("");
  lines.push(
    input.location
      ? "If you cannot reach them, that is where and when they last were."
      : "If you cannot reach them, that is the time they last used their phone.",
  );
  lines.push(`Reference: ${input.sessionRef}`);

  return lines.join("\n");
}

/**
 * Phone numbers, kept deliberately permissive.
 *
 * Indian numbers get written with +91, with 0, with spaces and with dashes,
 * and a contact list that rejects the way somebody actually saved their
 * sister's number is a contact list that stays empty until it is needed.
 * Anything with enough digits to dial is accepted; the SMS app can be the one
 * to complain.
 */
export function isDialable(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function normalisePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}
