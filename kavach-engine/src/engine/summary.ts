import { loadCorpus, provisionsFor } from "../corpus/loader.js";
import type { LlmProvider } from "../llm/provider.js";
import type { IncidentPacket, SessionState } from "../types.js";
import { establishedFacts } from "./facts.js";

/**
 * PRD R8 — the lawyer handoff.
 *
 * Everything here except `narrative` is mechanically derived from the session
 * record. The narrative is the only generated prose, it is explicitly barred
 * from making legal claims, and it is labelled as generated in the output.
 */
export async function buildPacket(state: SessionState, provider: LlmProvider): Promise<IncidentPacket> {
  const corpus = loadCorpus();

  const timeline: IncidentPacket["timeline"] = [];
  for (const t of state.turns) {
    timeline.push({ at: t.at, kind: "turn", detail: `${t.speaker}: ${t.text}` });
  }
  for (const f of state.flags) {
    timeline.push({ at: f.at, kind: "flag", detail: `[${f.severity.toUpperCase()}] ${f.ruleId} — ${f.statement}` });
  }

  const scenariosTraversed: IncidentPacket["scenariosTraversed"] = [];
  let last: string | null = null;
  state.updates.forEach((u) => {
    if (u.scenarioId && u.scenarioId !== last) {
      scenariosTraversed.push({ scenarioId: u.scenarioId, title: u.scenarioTitle ?? u.scenarioId, fromTurn: u.turnIndex });
      timeline.push({ at: u.at, kind: "scenario-change", detail: `identified as: ${u.scenarioTitle}` });
      last = u.scenarioId;
    }
  });
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  const factsEstablished = establishedFacts(state.facts).map(({ fact, value }) => {
    const obs = [...state.observations].reverse().find((o) => o.fact === fact);
    return { fact, value: value as never, evidence: obs?.evidence ?? "(derived by the engine)", at: obs?.at ?? state.startedAt };
  });

  const provisionIds = new Set<string>();
  for (const u of state.updates) for (const p of u.provisionsCited) provisionIds.add(p.id);
  for (const f of state.flags) for (const id of f.provisionIds) provisionIds.add(id);

  const factSummary = factsEstablished.map((f) => `  - ${f.fact} = ${String(f.value)}  ("${f.evidence}")`).join("\n");
  const flagSummary = state.flags.map((f) => `  - [${f.severity}] ${f.statement}`).join("\n");

  let narrative: string;
  try {
    narrative = await provider.narrate({ transcript: state.turns, factSummary, flagSummary });
  } catch (e) {
    narrative = `Narrative generation failed (${(e as Error).message}). The structured record below is complete and is the authoritative part of this packet.`;
  }

  const started = new Date(state.startedAt).getTime();
  const ended = state.turns.length ? new Date(state.turns[state.turns.length - 1]!.at).getTime() : started;

  return {
    sessionId: state.sessionId,
    generatedAt: new Date().toISOString(),
    corpusVersion: state.corpusVersion,
    durationSeconds: Math.round((ended - started) / 1000),
    timeline,
    factsEstablished,
    scenariosTraversed,
    flags: state.flags,
    provisionsSurfaced: provisionsFor(corpus, [...provisionIds]),
    transcript: state.turns,
    narrative,
    unverifiedContentWarning: corpus.meta.status === "counsel-signed-off" ? null : corpus.meta.unverifiedContentWarning,
  };
}

export function packetToMarkdown(p: IncidentPacket): string {
  const L: string[] = [];
  L.push(`# Incident packet — session ${p.sessionId}`);
  L.push("");
  if (p.unverifiedContentWarning) {
    L.push(`> **WARNING — UNVERIFIED CORPUS**`);
    L.push(`> ${p.unverifiedContentWarning}`);
    L.push("");
  }
  L.push(`- Generated: ${p.generatedAt}`);
  L.push(`- Corpus version: \`${p.corpusVersion}\``);
  L.push(`- Session duration: ${p.durationSeconds}s`);
  L.push(`- Turns recorded: ${p.transcript.length}`);
  L.push("");

  L.push(`## Summary`);
  L.push("");
  L.push(`*Machine-generated narrative. Contains no legal analysis. Verify against the transcript below.*`);
  L.push("");
  L.push(p.narrative);
  L.push("");

  L.push(`## Concerns flagged`);
  L.push("");
  if (p.flags.length === 0) {
    L.push("None. The rule engine did not identify any provision-backed concern from the facts established.");
  } else {
    for (const f of p.flags) {
      L.push(`### [${f.severity.toUpperCase()}] ${f.ruleId}`);
      L.push("");
      L.push(f.statement);
      L.push("");
      L.push(`- Provisions: ${f.provisionIds.join(", ") || "—"}`);
      L.push(`- Raised at turn: ${f.raisedAtTurn} (${f.at})`);
      if (f.basis.length) {
        L.push(`- Basis:`);
        for (const b of f.basis) L.push(`  - \`${b.fact}\` = ${String(b.value)} — turn ${b.turnIndex}: "${b.evidence}"`);
      }
      L.push("");
    }
  }

  L.push(`## Facts established`);
  L.push("");
  L.push(`| Fact | Value | Evidence from transcript |`);
  L.push(`|---|---|---|`);
  for (const f of p.factsEstablished) {
    L.push(`| \`${f.fact}\` | ${String(f.value)} | ${f.evidence.replace(/\|/g, "\\|")} |`);
  }
  L.push("");

  L.push(`## Scenarios identified`);
  L.push("");
  for (const s of p.scenariosTraversed) L.push(`- turn ${s.fromTurn}: **${s.title}** (\`${s.scenarioId}\`)`);
  if (!p.scenariosTraversed.length) L.push("- None identified with confidence; universal safe actions were given throughout.");
  L.push("");

  L.push(`## Provisions surfaced during the session`);
  L.push("");
  for (const pr of p.provisionsSurfaced) {
    const v = pr.verification.status === "counsel-signed-off"
      ? `signed off ${pr.verification.signedOffAt} by ${pr.verification.advocate}`
      : `**${pr.verification.status.toUpperCase()}**`;
    L.push(`- **${pr.act} — ${pr.section}** (\`${pr.id}\`): ${pr.summary}  _[${v}]_`);
  }
  if (!p.provisionsSurfaced.length) L.push("- None.");
  L.push("");

  L.push(`## Timeline`);
  L.push("");
  for (const e of p.timeline) L.push(`- \`${e.at}\` **${e.kind}** — ${e.detail}`);
  L.push("");

  L.push(`## Verbatim transcript`);
  L.push("");
  for (const t of p.transcript) L.push(`**[${t.index}] ${t.speaker}** (${t.at}): ${t.text}`);
  L.push("");
  L.push("---");
  L.push("");
  L.push("*This packet is rights information generated by an automated system under Indian central law. It is not legal advice and it is not a substitute for an advocate's assessment. State rules may differ. The audio and location artifacts referenced by this session are stored separately.*");
  return L.join("\n");
}
