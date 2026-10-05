# kavach-engine

The headless core of Kavach — a rights-in-the-moment agent for India.

It takes a live transcript of a police encounter turn by turn, works out what
kind of encounter it is, tracks what has been established as true, flags
conduct that appears unlawful, and hands the user a ranked set of things they
can do — then produces a packet a lawyer can act on.

> **This corpus is UNVERIFIED. Do not put this in front of a user.**
> Every section number is a structural placeholder taken from the PRD table.
> None has been checked against a bare act, and no advocate has signed anything
> off. The engine attaches that warning to every packet it produces, by design.

---

## Why it is built this way

One rule shapes every file: **the model never authors a legal claim.**

A hallucinated section number is the single most dangerous output this system
can produce, because the user repeats it out loud to a police officer. So the
model is confined to perception — reading the transcript, picking a scenario id
from a fixed enum, and reporting facts it can quote verbatim. Everything the
user hears comes out of a versioned corpus. Everything the engine concludes
comes out of deterministic rules an advocate can read and sign.

There are three independent places a bad output has to get through:

| Layer | Rejects |
|---|---|
| **Provider boundary** (`engine/session.ts`) | scenario ids not in the corpus, fact keys not in the schema, facts with no supporting quote |
| **Rule engine** (`engine/rules.ts`) | anything resting on a fact that was never established — `unknown` satisfies no predicate, ever |
| **Output guard** (`engine/guard.ts`) | section numbers absent from the corpus, confrontational or escalating phrasing, outcome predictions, a fallback that cites law |

When the guard trips, the engine degrades to the universal safe actions rather
than suppressing the violation and shipping anyway. `test/run.ts` runs a
deliberately hostile provider to prove all three hold.

## What this adds to the PRD

Three gaps between the written PRD and the product as described out loud:

1. **The PRD was one-shot; the product is a loop.** Every turn reclassifies.
   A document check becoming a key seizure becoming a cash demand becoming
   "come to the station" is the normal case, and the replay fixture walks
   exactly that path.
2. **The PRD had no live misconduct check.** `corpus/rules/misconduct.json` is
   a declarative rule set evaluated on every turn, each rule citing provisions
   and carrying the evidence that fired it.
3. **The PRD gave one line; the product gives options.** `engine/options.ts`
   returns a ranked set with exactly one marked safest, filtered by what is
   actually true (a woman-specific option is never shown to a man), and
   re-ordered when a rule fires.

The PRD's own open question — whether the lawyer packet is P0 — is answered
here in the affirmative: `engine/summary.ts` is built, because the packet is
the artifact that makes the ninety seconds worth anything afterwards.

## Run it

```bash
npm install
npm run validate                  # corpus integrity — 0 errors required
npm test                          # 155 tests, incl. the hostile provider
npm run eval                      # perception scorecard on eval/cases.json
npm run eval -- --cases eval/holdout.json   # ...and on the held-out set
npm run replay -- fixtures/transcripts/escalating-traffic-stop.json
npm run replay -- fixtures/transcripts/escalating-traffic-stop.json --packet
npm run dev                       # HTTP API on :8787
```

Nothing above needs an API key. The default provider is a deterministic
keyword classifier — it exists so the engine is testable offline, and because
the PRD's 8-second latency budget on a weak network will likely need an
on-device path that cannot call a model at all. This is the honest baseline
that path has to beat. For the live one:

```bash
KAVACH_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npm run replay -- <fixture>
KAVACH_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npm run eval -- --cases eval/holdout.json --out eval/results/anthropic.json
```

The model defaults to `claude-sonnet-5-5`; set `KAVACH_ANTHROPIC_MODEL` to
change it. The provider name carries the model (`anthropic:<id>`), so `/health`,
replay and eval reports say which model perceived the encounter.

### The perception eval

`npm run eval` replays labelled transcripts and scores whatever provider is
configured. Two numbers are **gates** and fail the run above zero: an
*inverted* fact (labelled `yes`, extracted `no`, or the reverse) and a *false
flag* (a misconduct flag the labels say must not fire). The rule engine trusts
extraction, so those are the errors nothing downstream can catch. Accuracy and
recall are scores, printed, not gated.

There are two sets. `eval/cases.json` is the tuning set: cue fixes are checked
against it, so the mock scores near 100% there and that number means little.
`eval/holdout.json` was written without looking at the cue table and must
never be used to tune it. On 4 October 2026 the mock scored **45% scenario
accuracy and 61% fact recall on the holdout**, with zero inversions after one
fix. That is the baseline a live model has to beat, and the gap is the case
for one. Add real field transcripts to both as they arrive; when the holdout
goes stale, write a fresh one and fold the old one into `cases.json`.

## HTTP API

The surface the Expo client will consume.

```
GET    /health                provider, corpus version, status, session count   (open)
GET    /corpus                full corpus — cache this for offline (PRD R10)
POST   /session               -> { sessionId }
POST   /session/:id/turn      { text, speaker? } -> { update, violations, latencyMs }
GET    /session/:id/packet    markdown  (?format=json for the structure)
DELETE /session/:id           permanent deletion (PRD R4)
```

CORS is open, so `expo start --web` and a browser tab both work.

### Authentication

Everything except `/health` needs a bearer token. `/corpus` and `POST /session`
take the **instance key**; every `/session/:id/*` route takes the **session
token** the engine minted for that session — a token for one session returns
403 on another. See `shared/README.md`.

Secrets come from the environment, or from a gitignored `.kavach-secrets.json`
generated at the repo root on first boot, so `npm run dev` works with no setup
and auth still on. `KAVACH_AUTH=0` turns it off and says so loudly on every
boot.

### Sessions on disk

Sessions are written to `sessions/` (gitignored) after every turn, so a
restart does not take the lawyer packet with it. That is not a free win, and
the PRD says so directly — *"where does evidence live, under whose
jurisdiction, and who can be compelled to produce it? A subpoena to the
evidence host is a foreseeable attack on the product's core promise."* What is
written is a verbatim transcript of an encounter with police.

So durability ships with the things that make it defensible:

| | |
|---|---|
| **Deletion** | `DELETE /session/:id` is immediate and permanent (PRD R4) |
| **Retention** | files older than `KAVACH_SESSION_RETENTION_DAYS` (7) are swept on boot |
| **An off switch** | `KAVACH_PERSIST_SESSIONS=0` restores in-memory-only exactly |

Writes are atomic (temp file plus rename), a corrupt file is skipped rather
than fatal, and a session id that is not a UUID never reaches the filesystem —
`remove()` is reachable from a URL path segment.

A session restored from disk keeps the corpus version it was recorded under.
Adding turns from a different corpus is refused with a 409: PRD R6 exists so a
later correction can identify who received what, and mixing two versions into
one audit trail would break that. The packet stays readable.

Session state is only reachable with that session's token.

## Layout

```
corpus/                  the only source of legal content
  meta.json              version + status; drives the warnings
  provisions.json        20 provisions, each with a verification block
  scenarios/*.json       the v1 ten
  fallback.json          what gets said when confidence is low — cites nothing
  rules/misconduct.json  11 declarative rules
src/
  types.ts               tri-state facts, scenarios, flags, packet
  corpus/                loader + structural validator
  llm/                   provider interface, mock, Anthropic
  engine/                facts · rules · options · guard · session · summary
  server/ cli/           HTTP API, replay harness, corpus validator
fixtures/transcripts/    scripted encounters for the harness
```

## What is deliberately absent

Audio capture, chunked upload, trusted-contact alerts, the lock-screen widget,
and auth. Those are the Expo app and the evidence service. This package is the part that has to be right first, because
everything else is a shell around it.

## Before any of this reaches a person

1. An advocate is engaged and named. Nothing ships without it.
2. Every provision is checked against a bare act, gazette notification or
   reported judgment — no blogs, no news, no SEO pages.
3. Every quotable line is reviewed for **escalation risk**, separately from
   legal accuracy. A line that is legally correct and gets someone hit is a
   failed line.
4. `corpus/meta.json` status moves to `counsel-signed-off`, and every
   scenario and rule carries a real advocate and date.

Until then `npm run validate` will keep warning on every file, and every packet
will carry the unverified banner. That is intentional. Do not remove it.
