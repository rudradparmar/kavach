# Kavach — project context

Rights-in-the-moment agent for India. A person stopped by police taps once; the
app listens, works out what kind of encounter it is, tells them what the law
says, flags conduct that appears unlawful, offers ranked actions, and produces
a packet for a lawyer.

Read `HANDOFF.md` first — it has current state and the next task.
`Kavach-PRD-v1.md` is the product spec. `docs/engine-architecture.md` explains
why the engine is shaped the way it is.

---

## Non-negotiable invariants

These are not style preferences. Violating any of them is how this product
gets someone hurt or arrested. If a change requires breaking one, stop and
raise it rather than working around it.

**1. The model never authors a legal claim.**
The LLM's only jobs are (a) pick a scenario id from a fixed enum and (b) report
facts it can quote verbatim from the transcript. Every provision, every
quotable line, every "the officer cannot do this" comes from `corpus/`. Never
add a prompt that asks a model to explain law, name a section, or phrase
advice. A hallucinated section number is the worst possible output here,
because the user repeats it out loud to a police officer.

**2. Three rejection layers stay independent.**
- Provider boundary (`src/engine/session.ts`) — drops scenario ids not in the
  corpus, fact keys not in the schema, facts with no supporting quote.
- Rule engine (`src/engine/rules.ts`) — `unknown` satisfies no predicate, ever.
  A misconduct flag must never fire because a fact was merely never established.
- Output guard (`src/engine/guard.ts`) — rejects ungrounded citations,
  escalating phrasing, outcome predictions, and a fallback that cites law.

Do not weaken a layer to make a test pass. When the guard trips on corpus
wording, reword the corpus — that is the correct direction. `test/run.ts` runs
a deliberately hostile provider against all three; keep it passing.

**3. De-escalation over confrontation.**
No output ever tells the user to resist, flee, refuse a lawful instruction, or
challenge an officer. The safest-ranked option is always a de-escalating one.
The guard enforces this with a phrase filter — extend the filter, never bypass it.

**4. Silence beats a wrong answer.**
When confidence is below the floor, the engine falls back to universal safe
actions that cite no law at all. Never make the fallback "helpful" by adding
provisions to it.

**5. The corpus is unverified and must say so.**
Every section number is a placeholder from the PRD table. No advocate has
signed anything. `corpus/meta.json` status stays `unverified`, every packet
carries the warning banner, and `npm run validate` keeps warning on every file.
Do not remove these to tidy up the output. They come off when an advocate
signs, not before.

This now extends to escalation routes (`corpus/escalation.json`): the
authorities, the deadlines and the drafts are placeholders under the same
rule, and the one in `deploy` terms is `app`'s `npm run preflight`, which
reports the corpus as a **blocker** and exits non-zero. That gate is the
mechanism. Do not make it pass by any route other than an advocate signing.

**5a. Nothing is inferred about a person.**
Officer details (R11) are user-entered, every record says `source: "user"`,
and the engine never reads a name, a number or a station out of a transcript.
A guessed attribution in an advocate's packet is worse than a blank, because
a blank is obviously a blank and a guess looks like evidence. The same rule
governs the escalation draft: `{{whatHappened}}` is structurally unfillable
and stays that way. The engine substitutes values from the record; it does
not narrate an incident into a document the user signs.

**5b. "Not supplied" and "none exists" are different statements.**
The packet's location trail and media bundle come from the evidence service
via the client — the engine cannot reach it and must not learn how. When they
are absent the packet says *not supplied*, never *none*. An advocate looking
at an empty media section has to be able to tell whether no audio was kept or
no audio was handed over.

**5c. A language reaches a user only by being added in three places.**
`corpus/languages.json`, the scenario files, and `app/src/tts/languages.ts`.
Each fails loudly on its own; the combination is what stops a language being
half-added. A missing voice must **disable** playback, never fall through to
the platform's substitute — Android hands Devanagari to an English engine and
produces confident gibberish that the user then says to an officer. The same
is true of Tamil, Telugu, Bengali and Kannada, and it is true silently.

Classifier cue counts must stay balanced across scenarios (the validator
enforces a spread of 8). A cue matched anywhere in history scores, so a
scenario with far more cues than its neighbours wins long sessions on volume
rather than on what was said.

**6. Jurisdiction is keyed from day one.**
Every provision and scenario carries `jurisdiction`, always `IN-CENTRAL` in v1.
State law is out of scope but the schema must not need retrofitting.

**7. Never optimise for engagement.**
No DAU, session length, or retention metrics. Success is a product people open
rarely and forget about.

## Working style

- TypeScript, strict, ESM, Node 20+. No build step needed to run — `tsx`.
- Deterministic code over model calls wherever the choice exists. The mock
  provider is the offline baseline an on-device path has to beat.
- Every fact carries the verbatim quote that justified it. No quote, no fact.
- Run `npm run validate`, `npm test` and `npm run eval` before considering
  anything done. The eval fails on any inverted fact or false flag.
- Never tune classifier cues or fact regexes against `eval/holdout.json`. Fix
  an inversion it finds (that is a gate), but leave its accuracy alone, or it
  stops measuring anything.
- A question or request is not a fact. "Why am I being arrested?" does not
  establish `groundsGiven=no`. The mock uses `unknown`-valued shield cues for
  this; a live provider is told the same in its prompt.
  From the repo root, `npm run verify` runs every check that needs no server.
- With the three services up, `app`'s `smoke`, `pipeline`, `evidence`, `auth`
  and `afterwards` scripts drive the client's real modules. `preflight` is
  different in kind: it asks whether the deployment is fit for the public
  rather than whether the code works, and it is the only check that is
  *supposed* to fail today.
