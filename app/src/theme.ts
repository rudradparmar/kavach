/**
 * Kavach client theme.
 *
 * Built for one situation: a frightened person holding a phone at arm's length,
 * possibly at night, possibly with an officer watching the screen. That drives
 * every value here — high contrast, large type, generous tap targets, and no
 * decoration that competes with the quotable line.
 */

export const colour = {
  /** Near-black rather than pure black: less glare at night, still high contrast. */
  bg: "#12141A",
  surface: "#1C1F27",
  surfaceRaised: "#252932",
  border: "#333845",

  text: "#F4F6FA",
  textMuted: "#A2AAB9",
  textFaint: "#6E7688",

  /** The safest option. The only green in the product — it means one thing. */
  safest: "#4ADE80",
  safestBg: "#12301F",

  /** Flag severities. Distinguishable by hue AND by icon AND by label,
   *  because colour alone fails in sunlight and for colourblind users. */
  unlawful: "#F87171",
  unlawfulBg: "#341617",
  irregular: "#FBBF24",
  irregularBg: "#33260A",
  info: "#60A5FA",
  infoBg: "#12243D",

  /** The UNVERIFIED banner. Deliberately loud. It is not decoration. */
  warn: "#FB923C",
  warnBg: "#3A2110",

  action: "#3B82F6",
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const type = {
  /** The quotable line, English. The largest text in the product. */
  display: 27,
  /** The quotable line, Hindi. Devanagari needs a little more line height. */
  displaySecondary: 21,
  heading: 19,
  body: 16,
  label: 14,
  small: 12.5,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

/** Minimum tap target. Below this, a shaking hand misses. */
export const TAP_MIN = 52;
