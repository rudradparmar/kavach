# Kavach engine — architecture decisions (v0.1.0)

Status: built, 21/21 tests passing, corpus UNVERIFIED.

## The governing rule

**The model never authors a legal claim.**

The model is confined to perception: read the transcript, pick a scenario id
from a fixed enum, report facts it can quote verbatim. Every word the user
hears comes from a versioned corpus. Every conclusion comes from deterministic
rules an advocate can read and sign.

Rationale: a hallucinated section number is the most dangerous possible output,
because the user repeats it out loud to a police officer (PRD Design Principle 3).

## Three independent rejection layers

1. **Provider boundary** (`src/engine/session.ts`) — drops scenario ids not in
   the corpus, fact keys not in the schema, and any fact arriving without a
   supporting verbatim quote. Everything refused is logged to
   `state.rejectedByBoundary` for audit.
2. **Rule engine** (`src/engine/rules.ts`) — facts are tri-state
   (`yes`/`no`/`unknown`). `unknown` satisfies no predicate, ever, so a
   misconduct flag can never fire because a fact was merely never established.
   Facts also never regress to unknown once established.
3. **Output guard** (`src/engine/guard.ts`) — rejects section numbers absent
   from the corpus, confrontational or escalating phrasing, outcome
   predictions, and a low-confidence fallback that cites law. On a trip the
   engine *degrades to the universal safe actions* rather than suppressing and
   shipping.

A hostile provider (returns invented scenario ids, invented fact keys,
unevidenced facts, and a narrative claiming "Section 999") is run against all
three in `test/run.ts`.

## Three gaps closed vs. the written PRD

| PRD as written | Product as described | Resolution |
|---|---|---|
| One-shot: classify once, answer once | "As the conversation progresses it learns new information" | Every turn reclassifies. Scenario is allowed to change mid-session; the fixture walks documents → keys → cash → station. |
| No live misconduct detection | "checks if the officer is doing anything illegal" | 11 declarative rules in `corpus/rules/misconduct.json`, evaluated each turn, each citing provisions and carrying the evidence that fired it. |
| One quotable line + one thing to document | "do this, do that, this is the safest bet" | Ranked option set, exactly one marked safest, filtered by established facts, re-ordered when a rule fires. |

The PRD's open question "is R8 (lawyer packet) P0?" is answered yes — it is
built, because the packet is what makes the 90 seconds worth anything after.

## Two defects found during the build

Recorded because both are the kind that recur.

1. **The guard false-positived on corpus wording.** The phrase "unlawful
   key-grab" in an option rationale matched the resistance filter, and the
   engine correctly degraded to the fallback rather than shipping it. Fixed by
   rewording the corpus, not by weakening the guard. That direction is the
   policy: the guard stays blunt, the content adapts.
2. **The classifier weighted stale turns.** It stayed on "documents not
   carried" for three turns after the keys were taken, because older cues
   outvoted the current one. Fixed by making recency dominate — the last turn
   scores 3, the previous 1, anything in history 0.5.

## Tension noted, not yet resolved

PRD Design Principle 5 says "rights information, not legal advice" — the
product tells you what the law *says*, not what you *should* do. But "this is
the safest bet" is advice-shaped. Current resolution: options are framed as
available actions with tradeoffs, and the safest-ranked one is always a
de-escalating action. This wording needs counsel review specifically.

## Deliberately absent

Audio capture, chunked upload, trusted-contact alerts, lock-screen widget,
offline caching, persistence, auth. Those belong to the Expo app and the
evidence service.

## Gate before anything reaches a person

1. Advocate engaged and named.
2. Every provision checked against a bare act / gazette / reported judgment.
3. Every quotable line reviewed for **escalation risk**, separately from legal
   accuracy.
4. `corpus/meta.json` status → `counsel-signed-off`.

Until then `npm run validate` warns on every file and every packet carries the
unverified banner. Intentional.
