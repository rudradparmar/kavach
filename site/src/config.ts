/** One place for anything that changes when the name or the contact details do. */
export const SITE = {
  /** "Kavach" is a working name. A rename is this one line. */
  name: "Kavach",
  tagline: "Calm, clear rights information for the moment you are stopped by police.",
  /** Replace with the real Tally embed URL, e.g. https://tally.so/embed/XXXXXX */
  waitlistUrl: "https://tally.so/embed/REPLACE_WITH_FORM_ID",
  /** Placeholder until a real address is supplied. .example is a reserved TLD. */
  contactEmail: "contact@kavach.example",
  footer: "Rights information, not legal advice. Legal content is unverified and under development.",
  demoBanner:
    "Recorded demo of the engine using placeholder content. Not legal advice. Do not use during a real stop.",
} as const;

export const waitlistConfigured = !SITE.waitlistUrl.includes("REPLACE_WITH");
export const contactConfigured = !SITE.contactEmail.endsWith(".example");
