import { loadCorpus, provisionsFor } from "../corpus/loader.js";
import type { LlmProvider } from "../llm/provider.js";
import type { EscalationGuidance, IncidentPacket, PacketSupplement, SessionState } from "../types.js";
import { establishedFacts } from "./facts.js";
import { describeOfficer } from "./officers.js";
import { reviewCorpus } from "./review.js";

/**
 * PRD R8 — the lawyer handoff.
 *
 * Everything here except `narrative` is mechanically derived from the session
 * record. The narrative is the only generated prose, it is explicitly barred
 * from making legal claims, and it is labelled as generated in the output.
 */
export async function buildPacket(
  state: SessionState,
  provider: LlmProvider,
  supplement: PacketSupplement = {},
): Promise<IncidentPacket> {
  const corpus = loadCorpus();

  const timeline: IncidentPacket["timeline"] = [];
  for (const t of state.turns) {
    timeline.push({ at: t.at, kind: "turn", detail: `${t.speaker}: ${t.text}` });
  }
  for (const f of state.flags) {
    timeline.push({ at: f.at, kind: "flag", detail: `[${f.severity.toUpperCase()}] ${f.ruleId} — ${f.statement}` });
  }
  for (const o of state.officers) {
    timeline.push({ at: o.recordedAt, kind: "turn", detail: `officer detail recorded by the user: ${describeOfficer(o)}` });
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
    officers: state.officers,
    debrief: state.debrief,
    debriefQuestions: corpus.debrief.questions,
    // Undefined and null mean different things downstream and the packet says
    // which: "not supplied" is not "none exists". An advocate looking at an
    // empty media section has to be able to tell whether no audio was kept or
    // no audio was handed over.
    locationTrail: supplement.locationTrail ?? null,
    mediaBundle: supplement.mediaBundle ?? null,
    corpusReview: reviewCorpus(corpus),
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

  L.push(`## Officer details recorded`);
  L.push("");
  L.push(`*Entered by the user during or after the encounter. Nothing in this section is inferred from the transcript.*`);
  L.push("");
  if (p.officers.length === 0) {
    L.push("None recorded. The absence of a name or buckle number here means the user did not enter one, not that none was given.");
  } else {
    L.push(`| Buckle | Name | Rank | Station | Vehicle | Unit | Other | Recorded |`);
    L.push(`|---|---|---|---|---|---|---|---|`);
    for (const o of p.officers) {
      const cell = (v: string | null) => (v ? v.replace(/\|/g, "\\|") : "—");
      L.push(
        `| ${cell(o.buckleNumber)} | ${cell(o.name)} | ${cell(o.rank)} | ${cell(o.station)} | ` +
          `${cell(o.vehicleNumber)} | ${cell(o.unit)} | ${cell(o.description)} | ${o.recordedAt} |`,
      );
    }
  }
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

  L.push(`## Location trail`);
  L.push("");
  if (p.locationTrail === null) {
    L.push(
      "Not supplied. The engine does not collect location; a trail reaches this packet only when the client " +
        "fetches it from the evidence service and includes it. An empty section here does not mean no fix was taken.",
    );
  } else if (p.locationTrail.length === 0) {
    L.push("Supplied, and empty — no position fix was recorded with any audio segment of this session.");
  } else {
    L.push(`*${p.locationTrail.length} fix(es), each recorded alongside an audio segment by the evidence service.*`);
    L.push("");
    L.push(`| Time | Latitude | Longitude | Segment |`);
    L.push(`|---|---|---|---|`);
    for (const f of p.locationTrail) {
      L.push(`| ${f.at} | ${f.latitude.toFixed(6)} | ${f.longitude.toFixed(6)} | ${f.seq ?? "—"} |`);
    }
  }
  L.push("");

  L.push(`## Media bundle`);
  L.push("");
  if (p.mediaBundle === null) {
    L.push(
      "Not supplied. Audio, where it exists, is held by the evidence service and is not part of this document. " +
        "A manifest reaches this packet only when the client includes it.",
    );
  } else if (p.mediaBundle.chunks.length === 0) {
    L.push("Supplied, and empty — the evidence service holds no audio for this session.");
  } else {
    const mb = (p.mediaBundle.totalBytes / (1024 * 1024)).toFixed(2);
    L.push(`Held by **${p.mediaBundle.serviceLabel}**: ${p.mediaBundle.chunks.length} segment(s), ${mb}MB.`);
    L.push("");
    L.push(
      "Each receipt time and hash below was recorded by the service over the bytes as they arrived, not taken " +
        "from the device. **The segments are not one continuous recording** — the recorder stops and restarts " +
        "between them, and capture pauses when the app is not in the foreground.",
    );
    L.push("");
    L.push(`| Seq | Received (server clock) | Captured (device clock) | Bytes | SHA-256 |`);
    L.push(`|---|---|---|---|---|`);
    for (const c of p.mediaBundle.chunks) {
      L.push(`| ${c.seq} | ${c.receivedAt} | ${c.capturedAt ?? "—"} | ${c.bytes} | \`${c.sha256}\` |`);
    }
  }
  L.push("");

  L.push(`## Post-incident debrief`);
  L.push("");
  if (p.debrief.length === 0) {
    L.push("Not answered.");
  } else {
    const prompts = new Map(p.debriefQuestions.map((q) => [q.id, q.prompt]));
    const late = p.debrief.some((a) => a.afterWindow);
    L.push(`*Answered by the user after the encounter.*`);
    if (late) {
      L.push("");
      L.push(
        "> Some answers were given after the 24-hour window closed and are marked. They are kept rather than " +
          "discarded; weigh them accordingly.",
      );
    }
    L.push("");
    for (const a of p.debrief) {
      L.push(`**${prompts.get(a.questionId) ?? a.questionId}**`);
      L.push("");
      L.push(`${a.value}`);
      L.push("");
      L.push(`_answered ${a.answeredAt}${a.afterWindow ? " — after the 24-hour window" : ""}_`);
      L.push("");
    }
  }
  L.push("");

  L.push(`## Corpus review state (PRD R6)`);
  L.push("");
  L.push(
    `Checked ${p.corpusReview.checkedAt}. Review interval ${p.corpusReview.reviewIntervalDays} days. ` +
      `${p.corpusReview.overdue.length} of ${p.corpusReview.total} corpus items are overdue for review` +
      (p.corpusReview.neverReviewed > 0 ? `, of which ${p.corpusReview.neverReviewed} have never been reviewed at all` : "") +
      `.`,
  );
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

/* ------------------------------------------------------------------ */
/* Print output (PRD R8 — "auto-generated PDF")                         */
/* ------------------------------------------------------------------ */

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * The packet as a self-contained, print-ready HTML document.
 *
 * ## Why HTML rather than a PDF written here
 *
 * R8 asks for a PDF. Producing one in this process would mean a PDF library
 * and an embedded font, and the font is the problem: a packet can contain
 * Devanagari, Tamil, Telugu, Bengali and Kannada in the same paragraph — the
 * transcript is whatever the person actually said. A PDF writer with the
 * wrong font does not fail; it emits blank boxes, and a lawyer receives a
 * document with the client's own words missing and no indication that
 * anything was lost.
 *
 * So the engine emits HTML with the page geometry already set, and whatever
 * prints it — the phone's own print pipeline, a browser, a headless renderer
 * in a service — supplies fonts that can shape those scripts. The PDF gets
 * made by something that already knows how to render Indic text, which is the
 * whole reason this is the split.
 *
 * Everything is inlined. No stylesheet, no font, no image is fetched: a
 * document about someone's encounter with police must not make a network
 * request when a lawyer opens it, from their office, months later.
 */
export function packetToHtml(p: IncidentPacket): string {
  const H: string[] = [];
  const esc = escapeHtml;

  H.push(`<!doctype html><html lang="en"><head><meta charset="utf-8">`);
  H.push(`<title>Incident packet — ${esc(p.sessionId)}</title>`);
  H.push(`<style>
@page { size: A4; margin: 18mm 16mm; }
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font: 11pt/1.5 "Noto Sans", "Segoe UI", system-ui, sans-serif; color: #111; background: #fff; }
h1 { font-size: 18pt; margin: 0 0 4pt; }
h2 { font-size: 13pt; margin: 20pt 0 6pt; padding-bottom: 3pt; border-bottom: 1px solid #bbb; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 12pt 0 4pt; page-break-after: avoid; }
p, li { orphans: 3; widows: 3; }
.warn { border: 2px solid #a00; background: #fff2f2; padding: 10pt; margin: 10pt 0 14pt; }
.warn strong { color: #a00; letter-spacing: .04em; }
.meta { color: #444; font-size: 9.5pt; margin: 0 0 6pt; }
.note { color: #555; font-style: italic; font-size: 9.5pt; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 6pt 0; page-break-inside: auto; }
th, td { border: 1px solid #ccc; padding: 4pt 5pt; text-align: left; vertical-align: top; word-break: break-word; }
th { background: #f2f2f2; font-weight: 600; }
tr { page-break-inside: avoid; }
code, .mono { font-family: "DejaVu Sans Mono", ui-monospace, monospace; font-size: 8.5pt; }
.sev { font-weight: 700; letter-spacing: .04em; }
.sev-unlawful { color: #a00; }
.sev-irregular { color: #a56100; }
.sev-info { color: #345; }
.turn { margin: 0 0 5pt; }
.turn .who { font-weight: 600; }
.turn .when { color: #666; font-size: 8.5pt; }
.empty { color: #555; }
footer { margin-top: 22pt; padding-top: 8pt; border-top: 1px solid #bbb; color: #444; font-size: 9pt; }
</style></head><body>`);

  H.push(`<h1>Incident packet</h1>`);
  H.push(`<p class="meta">Session <span class="mono">${esc(p.sessionId)}</span> · generated ${esc(p.generatedAt)} · corpus <span class="mono">${esc(p.corpusVersion)}</span> · ${p.durationSeconds}s · ${p.transcript.length} turn(s)</p>`);

  if (p.unverifiedContentWarning) {
    H.push(`<div class="warn"><strong>WARNING — UNVERIFIED CORPUS</strong><br>${esc(p.unverifiedContentWarning)}</div>`);
  }

  H.push(`<h2>Summary</h2>`);
  H.push(`<p class="note">Machine-generated narrative. Contains no legal analysis. Verify against the transcript.</p>`);
  H.push(`<p>${esc(p.narrative).replace(/\n/g, "<br>")}</p>`);

  H.push(`<h2>Officer details recorded</h2>`);
  H.push(`<p class="note">Entered by the user. Nothing in this section is inferred from the transcript.</p>`);
  if (p.officers.length === 0) {
    H.push(`<p class="empty">None recorded. The absence of a name or buckle number here means the user did not enter one, not that none was given.</p>`);
  } else {
    H.push(`<table><thead><tr><th>Buckle</th><th>Name</th><th>Rank</th><th>Station</th><th>Vehicle</th><th>Unit</th><th>Other</th></tr></thead><tbody>`);
    for (const o of p.officers) {
      const c = (v: string | null) => (v ? esc(v) : "—");
      H.push(`<tr><td>${c(o.buckleNumber)}</td><td>${c(o.name)}</td><td>${c(o.rank)}</td><td>${c(o.station)}</td><td>${c(o.vehicleNumber)}</td><td>${c(o.unit)}</td><td>${c(o.description)}</td></tr>`);
    }
    H.push(`</tbody></table>`);
  }

  H.push(`<h2>Concerns flagged</h2>`);
  if (p.flags.length === 0) {
    H.push(`<p class="empty">None. The rule engine did not identify any provision-backed concern from the facts established.</p>`);
  } else {
    for (const f of p.flags) {
      H.push(`<h3><span class="sev sev-${esc(f.severity)}">[${esc(f.severity.toUpperCase())}]</span> ${esc(f.ruleId)}</h3>`);
      H.push(`<p>${esc(f.statement)}</p>`);
      H.push(`<p class="meta">Provisions: ${esc(f.provisionIds.join(", ") || "—")} · raised at turn ${f.raisedAtTurn} (${esc(f.at)})</p>`);
      if (f.basis.length) {
        H.push(`<ul>`);
        for (const b of f.basis) {
          H.push(`<li><code>${esc(b.fact)}</code> = ${esc(String(b.value))} — turn ${b.turnIndex}: &ldquo;${esc(b.evidence)}&rdquo;</li>`);
        }
        H.push(`</ul>`);
      }
    }
  }

  H.push(`<h2>Facts established</h2>`);
  H.push(`<table><thead><tr><th>Fact</th><th>Value</th><th>Evidence from transcript</th></tr></thead><tbody>`);
  for (const f of p.factsEstablished) {
    H.push(`<tr><td><code>${esc(f.fact)}</code></td><td>${esc(String(f.value))}</td><td>${esc(f.evidence)}</td></tr>`);
  }
  if (!p.factsEstablished.length) H.push(`<tr><td colspan="3" class="empty">None established.</td></tr>`);
  H.push(`</tbody></table>`);

  H.push(`<h2>Scenarios identified</h2><ul>`);
  for (const s of p.scenariosTraversed) H.push(`<li>turn ${s.fromTurn}: <strong>${esc(s.title)}</strong> (<code>${esc(s.scenarioId)}</code>)</li>`);
  if (!p.scenariosTraversed.length) H.push(`<li class="empty">None identified with confidence; universal safe actions were given throughout.</li>`);
  H.push(`</ul>`);

  H.push(`<h2>Provisions surfaced</h2><ul>`);
  for (const pr of p.provisionsSurfaced) {
    const v = pr.verification.status === "counsel-signed-off"
      ? `signed off ${esc(String(pr.verification.signedOffAt))} by ${esc(String(pr.verification.advocate))}`
      : `<strong>${esc(pr.verification.status.toUpperCase())}</strong>`;
    H.push(`<li><strong>${esc(pr.act)} — ${esc(pr.section)}</strong> (<code>${esc(pr.id)}</code>): ${esc(pr.summary)} <em>[${v}]</em></li>`);
  }
  if (!p.provisionsSurfaced.length) H.push(`<li class="empty">None.</li>`);
  H.push(`</ul>`);

  H.push(`<h2>Location trail</h2>`);
  if (p.locationTrail === null) {
    H.push(`<p class="empty">Not supplied. The engine does not collect location; a trail reaches this packet only when the client fetches it from the evidence service and includes it. An empty section here does not mean no fix was taken.</p>`);
  } else if (p.locationTrail.length === 0) {
    H.push(`<p class="empty">Supplied, and empty — no position fix was recorded with any audio segment of this session.</p>`);
  } else {
    H.push(`<table><thead><tr><th>Time</th><th>Latitude</th><th>Longitude</th><th>Segment</th></tr></thead><tbody>`);
    for (const f of p.locationTrail) {
      H.push(`<tr><td>${esc(f.at)}</td><td>${f.latitude.toFixed(6)}</td><td>${f.longitude.toFixed(6)}</td><td>${f.seq ?? "—"}</td></tr>`);
    }
    H.push(`</tbody></table>`);
  }

  H.push(`<h2>Media bundle</h2>`);
  if (p.mediaBundle === null) {
    H.push(`<p class="empty">Not supplied. Audio, where it exists, is held by the evidence service and is not part of this document.</p>`);
  } else if (p.mediaBundle.chunks.length === 0) {
    H.push(`<p class="empty">Supplied, and empty — the evidence service holds no audio for this session.</p>`);
  } else {
    const mb = (p.mediaBundle.totalBytes / (1024 * 1024)).toFixed(2);
    H.push(`<p>Held by <strong>${esc(p.mediaBundle.serviceLabel)}</strong>: ${p.mediaBundle.chunks.length} segment(s), ${mb}MB.</p>`);
    H.push(`<p class="note">Each receipt time and hash was recorded by the service over the bytes as they arrived, not taken from the device. The segments are <strong>not one continuous recording</strong>: the recorder stops and restarts between them, and capture pauses when the app is not in the foreground.</p>`);
    H.push(`<table><thead><tr><th>Seq</th><th>Received (server)</th><th>Captured (device)</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>`);
    for (const c of p.mediaBundle.chunks) {
      H.push(`<tr><td>${c.seq}</td><td>${esc(c.receivedAt)}</td><td>${esc(c.capturedAt ?? "—")}</td><td>${c.bytes}</td><td><code>${esc(c.sha256)}</code></td></tr>`);
    }
    H.push(`</tbody></table>`);
  }

  H.push(`<h2>Post-incident debrief</h2>`);
  if (p.debrief.length === 0) {
    H.push(`<p class="empty">Not answered.</p>`);
  } else {
    const prompts = new Map(p.debriefQuestions.map((q) => [q.id, q.prompt]));
    if (p.debrief.some((a) => a.afterWindow)) {
      H.push(`<p class="note">Some answers were given after the 24-hour window closed and are marked. They are kept rather than discarded; weigh them accordingly.</p>`);
    }
    for (const a of p.debrief) {
      H.push(`<h3>${esc(prompts.get(a.questionId) ?? a.questionId)}</h3>`);
      H.push(`<p>${esc(a.value).replace(/\n/g, "<br>")}</p>`);
      H.push(`<p class="meta">answered ${esc(a.answeredAt)}${a.afterWindow ? " — after the 24-hour window" : ""}</p>`);
    }
  }

  H.push(`<h2>Timeline</h2><table><thead><tr><th>Time</th><th>Kind</th><th>Detail</th></tr></thead><tbody>`);
  for (const e of p.timeline) H.push(`<tr><td class="mono">${esc(e.at)}</td><td>${esc(e.kind)}</td><td>${esc(e.detail)}</td></tr>`);
  H.push(`</tbody></table>`);

  H.push(`<h2>Verbatim transcript</h2>`);
  for (const t of p.transcript) {
    H.push(`<p class="turn"><span class="who">[${t.index}] ${esc(t.speaker)}</span> <span class="when">${esc(t.at)}</span><br>${esc(t.text)}</p>`);
  }
  if (!p.transcript.length) H.push(`<p class="empty">No turns were recorded.</p>`);

  H.push(`<h2>Corpus review state</h2>`);
  H.push(`<p>Checked ${esc(p.corpusReview.checkedAt)}. Review interval ${p.corpusReview.reviewIntervalDays} days. ${p.corpusReview.overdue.length} of ${p.corpusReview.total} corpus items are overdue for review${p.corpusReview.neverReviewed > 0 ? `, of which ${p.corpusReview.neverReviewed} have never been reviewed at all` : ""}.</p>`);

  H.push(`<footer>This packet is rights information generated by an automated system under Indian central law. It is not legal advice and it is not a substitute for an advocate&rsquo;s assessment. State rules may differ. The audio and location artifacts referenced by this session are stored separately.</footer>`);
  H.push(`</body></html>`);
  return H.join("\n");
}

/* ------------------------------------------------------------------ */
/* Escalation guidance as text (PRD R9)                                 */
/* ------------------------------------------------------------------ */

export function escalationToMarkdown(g: EscalationGuidance): string {
  const L: string[] = [];
  L.push(`# What you can do next — session ${g.sessionId}`);
  L.push("");
  if (g.unverifiedContentWarning) {
    L.push(`> **WARNING — UNVERIFIED CORPUS**`);
    L.push(`> ${g.unverifiedContentWarning}`);
    L.push("");
  }
  L.push(`> ${g.disclaimer}`);
  L.push("");
  L.push(`Generated ${g.generatedAt} from corpus \`${g.corpusVersion}\`.`);
  L.push("");

  if (g.options.length === 0) {
    L.push("No route in this corpus matches this session.");
    return L.join("\n");
  }

  for (const [i, o] of g.options.entries()) {
    L.push(`## ${i + 1}. ${o.route.title}`);
    L.push("");
    L.push(`_Offered because: ${o.because.join(", ")}_`);
    L.push("");
    L.push(`**Who hears it.** ${o.route.authority.name} — ${o.route.authority.remit}`);
    L.push("");
    for (const h of o.route.authority.howToReach) L.push(`- ${h}`);
    L.push("");
    L.push(`**Deadline.** ${o.route.deadline.text}`);
    L.push("");
    L.push(`**What it has to contain.**`);
    for (const c of o.route.requiredContents) L.push(`- ${c}`);
    L.push("");
    L.push(`**Watch out for.**`);
    for (const c of o.route.cautions) L.push(`- ${c}`);
    L.push("");
    if (o.provisions.length) {
      L.push(`**Provisions referenced.** ${o.provisions.map((p) => `${p.act} ${p.section}`).join("; ")}`);
      L.push("");
    }
    if (o.unfilled.length) {
      L.push(`> This draft has ${o.unfilled.length} blank(s) only you can fill: ${o.unfilled.map((u) => `\`{{${u}}}\``).join(", ")}. Each appears in the text as a line of underscores.`);
      L.push("");
    }
    L.push("```");
    L.push(o.draft);
    L.push("```");
    L.push("");
  }
  return L.join("\n");
}
