import { randomUUID } from "node:crypto";
import type { OfficerRecord, SessionState } from "../types.js";

/**
 * PRD R11 — officer detail capture.
 *
 * The corpus tells a user, in almost every scenario, that the officer's
 * identity is the fact most often missing later. Until this existed it said
 * that and gave them nowhere to put it, and R8's packet had an officer
 * section with nothing in it.
 *
 * Two rules govern this file, and both are about what it does *not* do.
 *
 * **Nothing is inferred.** The engine does not read a name out of the
 * transcript, does not guess a station from a location, and never will. A
 * guessed attribution in an advocate's packet is worse than a blank, because
 * a blank is obviously a blank and a guess looks like evidence. Every field
 * is user-entered and every record says `source: "user"` so the packet can
 * state that rather than imply it.
 *
 * **Nothing is required.** A person recording an officer's buckle number is
 * standing in front of that officer. A form that refuses to save until it is
 * complete is a form that gets abandoned, and a partial record — a buckle
 * number and nothing else — is exactly the record that turns out to matter.
 */

export type OfficerInput = Partial<
  Pick<OfficerRecord, "name" | "buckleNumber" | "rank" | "station" | "vehicleNumber" | "unit" | "description">
>;

const FIELDS = ["name", "buckleNumber", "rank", "station", "vehicleNumber", "unit", "description"] as const;

/** Trim, and treat an empty string as absent rather than as an answer of "". */
const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, 500);
};

export function isEmptyOfficer(input: OfficerInput): boolean {
  return FIELDS.every((f) => clean(input[f]) === null);
}

export function upsertOfficer(state: SessionState, input: OfficerInput, id?: string, at = new Date()): OfficerRecord {
  const now = at.toISOString();
  const existing = id ? state.officers.find((o) => o.id === id) : undefined;

  if (existing) {
    for (const f of FIELDS) {
      // Only fields actually present in the payload are touched, so a form
      // that sends one corrected field does not blank the other six.
      if (f in input) existing[f] = clean(input[f]);
    }
    existing.updatedAt = now;
    return existing;
  }

  const record: OfficerRecord = {
    id: id ?? randomUUID(),
    name: clean(input.name),
    buckleNumber: clean(input.buckleNumber),
    rank: clean(input.rank),
    station: clean(input.station),
    vehicleNumber: clean(input.vehicleNumber),
    unit: clean(input.unit),
    description: clean(input.description),
    source: "user",
    recordedAt: now,
    updatedAt: now,
  };
  state.officers.push(record);
  return record;
}

export function removeOfficer(state: SessionState, id: string): boolean {
  const before = state.officers.length;
  state.officers = state.officers.filter((o) => o.id !== id);
  return state.officers.length < before;
}

/** One line per officer, for the packet and for filling a complaint draft. */
export function describeOfficer(o: OfficerRecord): string {
  const bits: string[] = [];
  if (o.name) bits.push(o.name);
  if (o.rank) bits.push(`(${o.rank})`);
  if (o.buckleNumber) bits.push(`buckle ${o.buckleNumber}`);
  if (o.station) bits.push(`of ${o.station}`);
  if (o.vehicleNumber) bits.push(`vehicle ${o.vehicleNumber}`);
  if (o.unit) bits.push(`${o.unit} unit`);
  return bits.length > 0 ? bits.join(" ") : "(no identifying detail recorded)";
}
