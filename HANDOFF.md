# Handoff — where this stands

Last updated: 4 October 2026. Under version control since 4 September (local only — no remote yet; see below).

## The short version

Every PRD requirement now has something built against it. **One thing stands
between this and public use, and it is not engineering:** the corpus is
unverified placeholder law and no advocate has read it.

`cd app && npm run preflight` is the gate. It reports that as a blocker and
exits non-zero. Everything else it checks is green against a local deployment,
and the two remaining warnings are the mock speech provider (needs a key) and
plain HTTP on loopback (a real deployment terminates TLS at Cloudflare's edge).

Built in this pass, all previously listed as missing: R9 escalation guidance,
R11 officer detail capture, R12 language expansion, R13 post-incident debrief,
R8's PDF output / location trail / media bundle, R4's periodic location, R6's
in-product staleness flagging, and instance-key rotation.

## 4 October pass — what changed

Nothing user-facing about the law changed; every legal field in the corpus is
byte-identical. All of it is perception, measurement and the first native work.

- **Fact cues no longer invent misconduct from a question.** "Why am I being
  arrested?" used to record `groundsGiven=no`, and "I informed my family"
  recorded `relativeInformed=no` — both fed UNLAWFUL flags. Questions and
  requests are now *shielded* (a cue valued `unknown` claims the fact for the
  turn and reports nothing), the user's own inaction ("I haven't told my
  family") is shielded too, and only an explicit statement records `no`.
  Decision recorded: a missed flag is safer than an invented one.
- **`giraftar` fixed.** `"usne giraftar nahi kaha"` no longer classifies as an
  arrest; the bare Latin cue became `giraftar kar` / `giraftar ho`, and the
  fact extractor has a Latin negative.
- **The perception eval exists** (`npm run eval`, see `kavach-engine/README.md`).
  It found two more inversions on its first run — "I am *not* wearing a
  helmet" recorded `helmetWorn=yes`, and "nobody was violent" recorded
  `assemblyPeaceful=no` — both fixed with polarity tests. And it found the
  real number: **on the held-out set the keyword mock gets 45% of scenarios
  right.** The 100% on the tuning set is the mock memorising its own cues.
  The live model has never been scored; that is now the most important
  measurement in the project.
- Cue quality: classifier cues are substring matches, so `force` matched "in
  force" and `hit` matched "white". Narrowed to `using force` / `hitting`.
  Added `section 163`, `prohibitory order`, `hand over your phone`,
  `are being arrested`, `गिरफ़्तार हो`. Counts stay within the spread limit.
- **The live model is configuration.** `KAVACH_ANTHROPIC_MODEL`, default
  `claude-sonnet-5-5` (the old hardcoded `claude-sonnet-4-5` is no longer in
  Anthropic's model list). The provider name now carries the model id, so
  `/health`, replay and eval say which model perceived an encounter. The
  extraction prompt now says a question is not evidence. SDK 0.32 → 0.131.
- **CI, one manual step left.** `Claude outputs/ci.yml` now holds the full
  workflow: the `afterwards` step, the preflight single-blocker assertion and
  both eval sets. Remote tools cannot write into `.github/`, so copy it over
  `.github/workflows/ci.yml` by hand. Until then CI runs the 4 September
  version, which has none of the three.
- **First native work** (untested on a device — `app/BUILD.md`): background
  recording through expo-audio's microphone foreground service, a "Start
  session" Android shortcut that opens `kavach://start` and starts a session
  with no further tap (R1), an `eas.json` for a field-test APK, and an honest
  line on the evidence card saying whether recording survives a screen lock.
  `expo prebuild` confirms the manifest; nothing has run on a phone.
- The engine's broken `build` script is gone (`typecheck` replaces it).

Verified 4 October, in a clean checkout: validate 0 errors; engine 155,
evidence 22, STT 11, app units 56 — all passing; app typecheck clean; smoke,
pipeline, evidence, auth and afterwards green against live services; both
eval sets pass their gates; preflight reports exactly the corpus blocker.

## What exists

`kavach-engine/` — the headless core. Complete and working.

- 10 scenarios, 20 provisions, 11 misconduct rules, all in `corpus/`, all
  marked UNVERIFIED.
- Stateful session engine that reclassifies on every turn, so an encounter can
  move from a document check to a key seizure to a cash demand to "come to the
  station" and the guidance follows it.
- Deterministic misconduct rule engine with tri-state facts.
- Ranked action options, exactly one marked safest, filtered by established
  facts, re-ordered when a rule fires.
- Output guard with three rejection layers.
- Lawyer packet builder (JSON + markdown).
- HTTP API with CORS, CLI replay harness, corpus validator.
- Authentication on all three services (`shared/auth.ts`). PRD R1 forbids a
  login, so authorisation attaches to the **session**, not a person: an
  instance key opens session creation and the corpus, and a per-session HMAC
  capability minted by the engine opens that one session on all three services.
  A token for one encounter returns 403 on another. `stt-service` and
  `evidence-service` verify it without knowing the engine exists.
- **Key rotation.** `KAVACH_API_KEYS` and `KAVACH_SESSION_SECRETS` list keys
  still accepted besides the current one. PRD R1 forbids a login, so every
  phone shares one instance key and there is no account to push a new one to:
  changing it in one step locks every installed app out at the same instant,
  and the instant anyone notices is a police stop. Two-step rotation, with the
  second step — emptying the list — being the one people skip, which is why
  the boot banner says ROTATING for as long as it is not empty.
- Sessions persisted to disk with atomic writes, so a restart does not take the
  lawyer packet with it. Ships with `DELETE /session/:id` (PRD R4), a
  retention sweep on boot, and `KAVACH_PERSIST_SESSIONS=0` to turn it all off
  — durability of a police-encounter transcript is a trade, not a free win.
  A restored session keeps its recorded corpus version and refuses new turns
  under a different one (409), so one audit trail never mixes two corpora.
- **Escalation guidance (R9).** Eight complaint routes in
  `corpus/escalation.json`, selected deterministically from the scenarios
  traversed and the flags raised — never by a model. Each carries the
  authority, its remit, concrete ways in, the deadline (including "none is
  stated", where that is the honest answer), required contents, cautions, and
  an editable draft. The engine fills the draft **by substitution only**:
  dates, the officer's buckle number, the corpus statements of the flags. It
  does not narrate. `{{whatHappened}}` and `{{complainantName}}` are
  structurally unfillable and are reported as blanks rather than invented.
  Every route goes through the same output guard as live guidance, one route
  at a time, so a bad route is withheld on its own and the client is told
  which and why.
- **Officer detail capture (R11).** `corpus/capture/officer-fields.json` holds
  the prompts, in usefulness order, buckle number first. Records are
  user-entered, nullable, partial-by-design and marked `source: "user"`.
  Nothing is inferred from the transcript and nothing ever should be. They
  reach the packet, and they fill the escalation draft.
- **Post-incident debrief (R13).** Ten questions, a 24-hour window, answers
  appended to the packet. Late answers are **kept and marked**, not dropped.
  An unknown question id is rejected at the boundary rather than stored —
  otherwise a client could put arbitrary text into a document an advocate
  reads as a structured record. Exactly one question carries the accuracy
  signal PRD R6 needs, and the validator enforces that there is exactly one.
- **Language expansion (R12).** Tamil, Telugu, Bengali, Marathi and Kannada
  alongside English and Hindi. Quotable lines in all seven, classifier cues in
  all six scripts, a `corpus/languages.json` registry, per-language
  translation status, and TTS subtags. Cue counts are balanced (spread of 4;
  the validator fails above 8).
- **Corpus review state (R6).** `reviewDueAt` has been a field in every corpus
  file since the schema was written and nothing read it. It is now read, and
  something never reviewed counts as **overdue rather than exempt** — see the
  note below on why the inverse would be exactly wrong.
- **The packet is complete (R8).** Officer details, debrief answers, the
  location trail, the media-bundle manifest, the corpus review state, and
  print-ready HTML that the phone turns into a PDF.
- 155 tests, including a deliberately hostile provider, a fact-polarity group,
  Latin/Devanagari parity, the session store, token forgery, key rotation,
  escalation guarding, and a session persisted before half these fields
  existed. All passing.

Verify in one command:

```bash
cd kavach-engine && npm install && npm run validate && npm test
npm run replay -- fixtures/transcripts/escalating-traffic-stop.json
```

No API key needed. Default provider is a deterministic keyword classifier.

---

`app/` — the Expo / React Native client. The guidance loop works on a phone.

- Start screen: one large tap target and nothing else on first paint — no
  login, no menu, no picker in the way (PRD R1). The ten scenario cards sit
  below the fold, for someone who cannot speak or has no signal.
- Live session screen rendering `GuidanceUpdate` — the quotable line at display
  size in English with Hindi beneath, the "do not say" list, ranked options
  with the safest visually dominant, accumulated misconduct flags with severity
  shown by icon *and* colour *and* word, the provisions behind the answer, and
  the disclaimer on every frame.
- Turns come from either a hold-to-speak microphone or a text composer, both
  with a sticky speaker toggle defaulting to Officer. Both produce the same
  thing — plain text plus a speaker label — and nothing downstream can tell
  which was used.
- The quotable line reads aloud on a tap, per language, at `rate: 0.78` — slow
  enough to repeat. Voice availability is read from `getAvailableVoicesAsync()`
  and a language with no voice gets a disabled control with a reason, because
  Android otherwise hands Devanagari to an English engine and produces
  confident gibberish the user then says to an officer. Playback stops the
  moment the guidance underneath it changes.
- Per-turn latency instrumentation against the PRD's 8s budget, labelled "tap
  to guidance"; the synthesis half is measured separately and shown beside the
  Play control.
- Offline scenario cards (PRD R10, and R1's "reachable for someone who cannot
  speak"). The whole corpus is cached on the device, version-stamped, and the
  ten scenarios sit below the fold on the start screen so first paint is still
  just START. A card states plainly that it is not a live session — no flags,
  no custody clock, and fact-gated options withheld.
- The lawyer packet (PRD R8) renders from the packet JSON, with the unverified
  warning first, and exports as markdown through the system share sheet. Ending
  a session offers it rather than binning the encounter. Sharing asks first,
  every time, and nothing is uploaded automatically.
- Trusted-contact alert (PRD R5). Contacts are configured from the start
  screen, which nags while the list is empty; an Alert button on every guidance
  frame composes a message with a live location fix and offers SMS (cellular)
  and the share sheet (data) — two independent networks, as R5 asks. The
  message is previewed before it goes, states no law and no flags, and
  attributes the scenario as a guess rather than a fact. Nothing sends
  automatically: expo-sms opens the composer and a human taps send, which is
  said on the contacts screen and again at the moment of sending.
- Evidence capture (PRD R4). Capture starts with the session; one `useCapture`
  hook owns the microphone and both consumers rotate through it — a ten-second
  timer for evidence, and two out-of-band rotations around a hold-to-speak so
  the utterance is transcribed *and* kept. Chunks are AES-256-GCM encrypted
  with a key in the platform keystore, queued on device, and deleted only once
  the service acknowledges them. The queue drains on a timer and reconciles
  against `/acks` on resume. Status is shown as two counts, never a
  percentage: "12 safely off this phone, 3 still on it".
- Engine address resolves from the Metro dev-server host by default, so no
  configuration is needed when the engine and bundler share a machine.
  Overridable in Settings, which has a health probe that distinguishes "wrong
  address" from "engine not running".

---

`evidence-service/` — chunk custody. 16 tests passing.

The PRD's second design principle is that the phone is not safe, so evidence
that lives only on the device is evidence that can disappear. This is where a
recording stops depending on the handset that made it.

- A **server-side timestamp** and a **SHA-256 recomputed over the bytes as they
  arrived**, never taken from the uploader. A client-supplied hash attests only
  that the client is consistent with itself.
- Uploads idempotent on `seq`, so a retry after a lost acknowledgement does not
  store ten seconds of an encounter twice. `GET /acks` is how a phone that was
  switched off works out what it still owes.
- `DELETE /session/:id` is immediate and takes the audio (PRD R4). Retention is
  bounded at 30 days, per-session size at 200MB.
- Authenticated like the other two, via `shared/auth.ts`. `requireSession`
  guards every `/session/:id/*` route, so a capability minted for one
  encounter returns 403 on another. It verifies the HMAC without ever calling
  the engine — no lookup, no round trip, no dependency.
- What it still lacks is **transport** security. A bearer token over plain HTTP
  is readable by anyone on the path, so this is a trusted-LAN service until TLS
  lands in front of it.

---

`stt-service/` — audio in, words out. 11 tests passing.

Separate from the engine on purpose: CLAUDE.md's first invariant is that the
model never authors a legal claim, and the engine's shape exists to make that
auditable. An advocate reading `kavach-engine/` should find only corpus,
deterministic rules and the guard. Putting a speech model beside that code
would make the boundary a comment instead of a fact about the repository.

- `mock` provider by default — cannot hear, returns canned romanised lines so
  the whole pipeline runs with no API key. Marked `simulated` in the response
  **and** in the text itself; the app surfaces both.
- `openai-compatible` provider covers OpenAI, Groq and self-hosted whisper.cpp
  through one implementation, so "the audio never leaves a machine we control"
  stays reachable without a rewrite.
- Stores nothing. Audio is transcribed and dropped.

Verify everything without a phone:

```bash
cd kavach-engine && npm run dev      # :8787, one terminal
cd stt-service   && npm run dev      # :8788, another
cd evidence-service && npm run dev   # :8789, another

cd app
npm run typecheck
npm run units      # pure logic + static-option parity with the engine
npm run smoke      # guidance loop + the packet, against a live engine
npm run pipeline   # perception loop: audio -> transcript -> guidance
npm run evidence   # custody chain: upload -> hash -> playback -> delete
npm run auth       # containment across all three services
```

`app/scripts/` drives the app's own client modules, not a reimplementation of
them, so a break in either boundary shows up without a device to hand. That is
why `src/api/url.ts`, `src/stt/client.ts`, `src/tts/languages.ts` and
`src/offline/staticOptions.ts` carry no React Native imports.

The client re-exports the engine's types through a `@engine/*` path alias
rather than copying them, using `import type` only — Babel erases those, so
nothing from the engine is bundled, but a change to `GuidanceUpdate` breaks the
app's typecheck instead of silently rendering stale guidance.

## Two defects closed in the Hindi pass

Recorded because both are the kind that recur, and both were invisible from
the outside — nothing errored, nothing logged, the product simply did less
than it appeared to.

**1. The classifier was romanised-Latin only, so Hindi speech fell back.**

Every `classifierCues` entry was romanised — `chaabi`, `paise`, `thane chalo` —
while speech recognition writes Hindi in Devanagari. Same speech, same meaning,
opposite outcome, on every turn, for most of the people the product is for.

Fixed by adding Devanagari cues to all ten scenario files (65 → 125 cues) and
Devanagari alternates to the fact regexes and amount regex in `llm/mock.ts`.
`classifierCues` are explicitly non-legal — "never shown to a user" — so
nothing here states a legal claim; every legal field in those files is
byte-identical. `fixtures/transcripts/escalating-traffic-stop-hi.json` mirrors
the canonical escalation, and both the engine suite and `app`'s
`npm run pipeline` now **fail** if the two scripts diverge.

Two asymmetries surfaced while doing it, both worth remembering: a bare cue
(`गिरफ़्तार`) fires on its own negation, so arrest cues need an affirmative
continuation; and because a cue matched anywhere in history scores 0.5, adding
cues unevenly across scenarios shifts long-session classification. Cue counts
are now roughly proportional.

**2. Four facts extracted the opposite of what was said.**

Within a fact the first matching cue wins, and broad affirmatives were listed
before their specific negatives. So `"I am not under arrest"` recorded
`arrestAsserted=yes`, `"without a receipt"` recorded `formalChallanOffered=yes`,
`"no female officer"` recorded `femaleOfficerPresent=yes`, and
`"I am wearing a helmet"` recorded `helmetWorn=no`.

The failure direction was suppression. `female-search-no-female-officer` is an
UNLAWFUL flag requiring `femaleOfficerPresent=no` — a value the extractor could
not produce from the natural phrasing, so **that flag could not fire at all**.
`cash-without-receipt` and `custody-without-status` were suppressed the same
way. `assemblyPeaceful` had no negative rule, which is the dangerous direction:
`"not peaceful"` would have recorded `yes` and fired an UNLAWFUL flag.

`engine/rules.ts` guarantees a flag never fires on an *unestablished* fact.
Nothing downstream can catch an *inverted* one — the rule engine trusts what
extraction hands it. Negatives now precede affirmatives, negation is matched
with a bounded gap, and a `fact polarity` group in `test/run.ts` asserts all of
it, including that the suppressed UNLAWFUL flag now fires.

**Closed on 4 October** (see the 4 October section). Kept for the reasoning.
Two cues mapped an affirmative phrase to `no` —
`relativeInformed` (`/inform(ed)? my (family|...)/ → no`) and `groundsGiven`
(`/why am i being arrested/ → no`). Both look like "the user is asking, so it
has not happened yet", which is defensible for *"let me inform my family"* and
wrong for *"I informed my family"*. `relativeInformed=no` fires
`arrest-relative-not-informed`, an UNLAWFUL flag, so getting it backwards
invents misconduct rather than hiding it. Left alone because the intent is
genuinely ambiguous and changing it changes flag behaviour — worth a decision.

Also unfixed: the pre-existing Latin cue `giraftar` in `arrest-now` is bare, so
`"usne giraftar nahi kaha"` still classifies as an arrest. Narrowing it changes
the Latin path, which was outside this pass.

---

`deploy/` — the deployment. Three services, one origin, free infrastructure.

- **One hostname, routed by path.** Caddy maps `/engine`, `/stt` and
  `/evidence` onto the three services and strips the prefix, so each stays
  unaware it is mounted anywhere. The client derives the other two from
  whichever address the engine is at, so Settings needs one URL, not three.
- **Cloudflare Tunnel** carries traffic in over an outbound-only connection.
  No inbound port is opened, so the host's firewall stays closed and there is
  no certificate to renew.
- **Oracle Cloud Always Free** is the target, chosen for the disk rather than
  the CPU. Both stores assume a persistent filesystem and **neither says so
  when it is missing** — the engine restores `0 sessions` and carries on, and
  evidence-service returns a clean 404 for audio that used to exist. On an
  ephemeral disk the service whose whole purpose is that a recording outlives
  the handset fails silently and looks healthy. Everything runs unchanged on
  any always-on machine if Oracle's ARM capacity is unavailable.
- `deploy/local-proxy.mjs` mirrors the Caddyfile so the deployed shape can be
  exercised without Docker. This matters because development runs port-mounted
  and never touches path routing, which is exactly how that path stayed broken.
  CI runs the whole integration matrix twice, port-mounted and path-mounted.
- Services are runnable in production for the first time: `tsx` was a
  devDependency while being the only working runtime, so `npm ci --omit=dev`
  removed the thing that runs the service. Moved to `dependencies`, `start`
  scripts added. The engine's `build` script, whose output could not find its
  corpus, has been removed; `npm run typecheck` replaces it.

## What does not exist

The four PRD requirements previously listed here — R9, R11, R12, R13 — are
built. What is left is hardware, keys, and people.

- **Gapless** capture. `expo-audio` has no segmented mode, so rotation stops
  and restarts the recorder and loses the milliseconds between chunks. A
  transcript assembled from them is not continuous audio.
- **Background upload.** In Expo Go recording stops when the phone locks. In
  a real build (4 October, untested) the recorder keeps going under a
  foreground service, but chunk rotation and upload are JavaScript and pause
  until the app is reopened, so audio recorded while locked is still only on
  the phone. Do not describe it as continuous off-device capture.
- Automatic alert delivery. `expo-sms` cannot send silently and
  Android never reports a result, so R5's "one tap sends" and the >=98%
  delivery metric need a server-side sender with credentials. The two channels
  and the message are built; only the sending is manual.
- Lock-screen entry (PRD R1). A home-screen "Start session" shortcut exists
  as of 4 October (untested); starting from a locked phone without unlocking
  does not.
- ~~TLS~~ — **done.** Cloudflare Tunnel terminates TLS at the edge, so there is
  a real certificate and no inbound port on the host. See `deploy/`.

  The blocker was never TLS itself. `app/src/stt/client.ts` and
  `app/src/evidence/client.ts` rebuilt sibling addresses as
  `protocol + hostname + a hardcoded 8788/8789`, so an engine reached at
  `https://api.example.com` — port 443 — produced
  `https://api.example.com:8788/transcribe`, which goes nowhere. Every TLS
  deployment was unreachable and nothing said so. `siblingUrl()` in
  `app/src/api/url.ts` now reads the engine URL's own path to pick the shape:
  a path means one host behind a proxy routing by prefix, no path means three
  processes on three ports.
- ~~Rate limiting~~ — **done**, with one non-obvious constraint recorded in
  `shared/ratelimit.ts`. The limiter is consulted **only after authorisation
  has already failed**, so a valid credential is never refused. Users in India
  routinely reach the internet through carrier-grade NAT, so one client address
  is shared by thousands of people; throttling by address after a successful
  auth would let one attacker on a carrier lock real users out of starting a
  session, at a police stop. The first version had this backwards and refused a
  valid key after 40 wrong ones.

- **Per-user identity.** Two people sharing a deployment share an instance key.
  Real multi-tenancy needs an identity model the PRD has not asked for.

## Decisions already made

- **Platform: Expo / React Native + TypeScript.** Chosen for one codebase and
  proximity to existing web/TS skills. The lock-screen widget will need a small
  native Android module later; everything else is JS.
- **First slice: the engine, headless.** Done. It was the riskiest part and the
  part the PRD was thinnest on.
- **Corpus: placeholder stubs, clearly marked.** Real content waits for an
  advocate. The schema is designed so content swaps in without code changes.
- **The lawyer packet is P0, not P1.** The PRD left this open; it is built.
- **Turns carry a speaker label even when typed.** A sticky Officer / Me / Unsure
  toggle, defaulting to Officer. Costs a tap when the speaker changes, but an
  unattributed transcript is close to worthless to the advocate who reads the
  packet, and officer utterances carry most of the classifier cues.
- **Flags accumulate in the client.** `GuidanceUpdate.newFlags` reports only
  what fired on that turn; a flag does not stop being true because the
  conversation moved on. The session keeps the running set and emphasises the
  newest. Verified in the fixture: the UNLAWFUL keys flag stays on screen
  through two later scenario changes.
- **The quotable line shows English at display size, Hindi beneath.** PRD R3
  requires both present and does not say which dominates; on a phone they
  cannot both. Revisit with counsel — the language the user actually speaks
  aloud is the one with the escalation risk.
- **Speech lives in its own service, not in the engine.** A `/transcribe` route
  on the engine would have been less work, which is the reason not to do it.
  The engine's auditability is the product's safety argument, and it is worth
  more than one saved process.
- **Expo Go is preserved.** On-device speech recognition would be better for
  latency and for "the phone is not safe", but it needs a native module and
  therefore a development build. Kept in Expo Go for now; the provider
  interface means swapping to on-device is a client-side change with no
  engine or API impact.
- **A voice turn is sent without a confirmation step.** The engine's confidence
  floor is the safety net for bad perception — a garbled transcript classifies
  to the fallback and the user gets the universal safe actions, which is the
  correct outcome. An extra tap costs more than it buys in a ninety-second
  encounter. What was heard is shown verbatim so the user can catch it.
- **The mock speech provider is loudly marked.** It cannot hear. Guidance built
  on canned text describes a situation that is not happening, so `simulated`
  appears in the response, in the transcript text itself, on the start screen,
  and above every transcript.

## Open questions the PRD still has

Two are blocking and are not engineering questions:

1. Liability posture if a user is charged with obstruction after repeating a
   line the agent gave them. This gates whether the quotable line ships at all.
2. Who signs off the corpus, and on what retainer. Nothing reaches a user
   without a named advocate.

One is a live design tension worth resolving in code:

3. PRD Design Principle 5 says "rights information, not legal advice" — what
   the law *says*, not what you *should* do. But the product as described
   offers "this is the safest bet", which is advice-shaped. Current resolution:
   options are framed as available actions with tradeoffs, and the
   safest-ranked one is always de-escalating. The wording needs counsel review.

## Suggested next task

**Score the live model on the holdout, then use it on a real handset.**

```bash
cd kavach-engine
KAVACH_LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... \
  npm run eval -- --cases eval/holdout.json --out eval/results/anthropic-holdout.json
```

That answers whether the live classifier is worth its latency and cost (mock:
45% scenario accuracy on the same set). Then build the APK per
`app/BUILD.md` and work through its checklist alongside the one below.

**Use it on a real handset.** The guidance loop, speech, offline cards, the
packet, the alert, evidence capture and now the officer form, the escalation
drafts and the debrief have all been built without a phone in the loop.
Several decisions above are guesses about how it feels that only a handset can
settle — the language chips on the quotable card, the officer form at arm's
length, and whether a 260px draft editor is usable on a phone at all.

After that, in order:

1. **Point `KAVACH_STT_PROVIDER` at Whisper and measure.** It is the only way
   to learn anything about code-mixed Hindi-English, roadside noise, and what
   an upload costs on a weak network. The latency readout exists for this.
2. **Native, round two.** Background recording and the shortcut are written
   (see `app/BUILD.md`). Still needed: chunk rotation and upload inside the
   foreground service (so audio recorded while locked leaves the phone while
   locked), gapless capture, and a Quick Settings tile for a lock-screen start.
3. **Fact extraction beyond Latin and Devanagari.** The five new languages
   classify and display, but establish no facts, so a Tamil session gets its
   scenario and no misconduct flags. Deliberately left: a fact extracted
   backwards defeats every layer below it, and machine-extending thirty fact
   regexes into five scripts is the highest-risk change available.
4. **Alert delivery**, if a server-side sender is ever wanted.

**Still blocked on people, not code.** No advocate is engaged, so the corpus
cannot leave `unverified`; and the PRD's liability question about the quotable
line is unanswered, which gates whether R3 ships in its current form at all.
Neither is an engineering task, and the product cannot reach a user until both
are closed. `npm run preflight` says so, in those terms, and exits non-zero.

## Deploying it

`README.md` is the deploy guide and `deploy/README.md` has the detail. Two
things worth repeating here because they are the ones that bite:

- **The host needs a real disk.** Both stores assume one and neither says so
  when it is missing. On an ephemeral filesystem the engine restores
  `0 sessions` and carries on, and evidence-service returns a clean 404 for
  audio that used to exist — the service whose entire purpose is that a
  recording outlives the handset fails silently and looks healthy.
- **`npm run preflight` is the go-live check**, and it is a different question
  from the test suites. They ask whether the code works; it asks whether this
  deployment should be in front of a person. It separates blockers (a user
  could be harmed or lose evidence) from warnings (something is degraded in a
  way the product already tells the user about), and CI asserts that the
  corpus gate is the *only* blocker — so a second one appearing fails the
  build rather than hiding behind the first.

## Things to be careful about

- The engine's fallback is deliberately unhelpful-looking. Do not "improve" it
  in the UI by adding legal detail. Its emptiness is the feature.
- The UNVERIFIED banner must survive into the client. A user must never see
  placeholder law presented as settled.
- Speaking a quotable line aloud is the highest-risk moment in the product.
  Playback is slowed for repeating, the text stays on screen throughout, and
  nothing is ever spoken unasked. Do not add an auto-play "to save a tap": a
  phone that starts talking by itself mid-encounter is a variable the user
  cannot take back, and the officer hears it too.
- A missing voice must disable playback, not fall through to the platform's
  substitute. Android hands Devanagari to an English engine and produces
  confident gibberish, and the user repeats it to an officer. When adding a
  language, add its subtags to `app/src/tts/languages.ts` and a row to
  `app/scripts/units.ts` — this failure is silent and only shows on a handset
  that actually has the voice.
- **`rank` and `safest` in the corpus are ordering inputs, not answers.**
  `engine/options.ts` re-ranks from scratch after filtering, and `search-frisk`
  carries two `safest: true` entries because of it. Anything that reads those
  fields straight off the JSON — an offline card, an export, a future web view
  — has to re-rank too, or it will show the wrong safest action, or none.
  `app/src/offline/staticOptions.ts` is the one existing port and
  `app/scripts/units.ts` pins it against the real function.
- Evidence chunks are deleted from the device **only after** the service
  acknowledges them. An optimistic delete is the exact failure the whole path
  exists to prevent, and it would be invisible until someone needed the audio.
- The rotation gap and the foreground-only limit are real. A chunk sequence is
  not continuous audio, and capture stops when the screen does. Do not let
  either quietly become "continuous recording" in a description to a user or an
  advocate.
- Auth secrets live in a gitignored `.kavach-secrets.json` generated on first
  boot, so `npm run dev` works with auth **on**. Do not "simplify" that to a
  default-off flag: making the zero-config path the insecure one is how
  services end up deployed wide open. `KAVACH_AUTH=0` exists, is explicit, and
  prints a warning on every boot.
- The alert message goes to someone who was not there and may show it to the
  officer. It states no law, carries no flags, and hedges the scenario as a
  guess. Adding "the officer is acting unlawfully" would feel helpful and would
  be a legal claim sourced from unverified placeholder corpus, asserted to a
  third party, with the user left holding it.
- The packet is the only artifact that outlives the encounter, and it contains
  a verbatim transcript of an interaction with police. Nothing uploads it
  automatically and nothing should: the confirm before sharing names what is in
  it, and that is the design, not friction to be optimised away.
- Persisting sessions made that transcript durable, which is the exposure the
  PRD flags as an open question. Deletion, retention and the off switch are
  what keep it defensible — if any of them is removed or quietly defaulted the
  other way, the trade stops being one. They are not optional extras around the
  feature; they are half of it.
- A parity test can pass for the wrong reason. The first version of that pin
  compared the port and the engine across the ten scenarios and went green even
  against a deliberately broken port, because the corpus happens to be
  redundant enough to mask the difference. The check that actually bites uses a
  synthetic scenario whose only safest option is fact-gated. When writing a
  regression guard, break the thing on purpose and confirm the guard fails.
- The client renders; it does not decide. No string in `app/` states what the
  law is — every provision, line, option and disclaimer is engine output shown
  verbatim. If a future change has the client composing legal text, that is
  CLAUDE.md invariant 1 being broken in a new place.
- The app surfaces a tripped output guard rather than swallowing it. If that
  notice appears, corpus wording needs fixing. Reword the corpus, never the
  guard.
- The mock speech provider cannot hear. If a demo looks impressive, check the
  start screen says SIMULATED before believing it — canned transcripts produce
  fluent, confident guidance about a situation that is not happening.
- Speech recognition cannot tell who is speaking. Do not infer the speaker from
  the audio. A guessed attribution in an advocate's packet is worse than
  `unknown`, because it looks like evidence.
- The engine's rejection layers guard against a model inventing law. Nothing
  guards against a microphone mishearing a sentence — only the user can catch
  that, which is why the transcript is shown verbatim above the guidance built
  on it. Do not hide it to save space.
- **A fact extracted backwards defeats every layer below it.** The tri-state
  design stops a flag firing on an unestablished fact; nothing stops one firing
  on an inverted fact, because the rule engine trusts extraction. When adding a
  cue, add its negation first and add a row to the `fact polarity` group.
- Cue lists are scored, so their *length* matters: a cue matched anywhere in
  history contributes 0.5, and a scenario with many more cues than its
  neighbours drifts upward as a session gets longer. Keep counts roughly even
  across scenarios when adding a language.
- **A limiter placed before an auth check refuses the people it is for.** The
  rate limiter is consulted only *after* authorisation has already failed, and
  that ordering is load-bearing rather than stylistic. Users here routinely
  share one public address through carrier-grade NAT, so throttling by address
  after a successful auth lets one attacker on a carrier lock real users out of
  starting a session — at a police stop, which is the only moment the product
  exists for. The first version had it the other way round and refused a valid
  key after forty wrong ones. If a limiter is ever added to a new route, charge
  it on rejection, never on arrival.
- **Maintenance that runs at boot does not run.** Both retention sweeps used to
  happen once, before `listen()`, which is fine for a process that restarts
  constantly and useless for one that stays up — which is now the deployment.
  A month-old instance held every session and every chunk of audio past every
  stated bound and reported nothing. `shared/lifecycle.ts` sweeps on a timer;
  anything else periodic belongs there too, not in a boot sequence.
- **`reviewDueAt: null` means overdue, not exempt.** Every corpus entry has it
  null today because nothing has ever been reviewed. Treating null as "no
  deadline set" would make the least-reviewed content in the system the only
  content that never gets flagged, and the flag would light up for the first
  time only after someone had already done the work — inverted exactly wrong.
  `neverReviewed` is counted separately so "nobody has started" stays
  distinguishable from "this lapsed".
- **An escalation route that trips the guard is withheld, not degraded.**
  There is no safe fallback for a complaint letter the way there is for a
  turn, so the route is dropped and the client is told which one and why. A
  route that vanishes silently reads as "the corpus has nothing to offer",
  when what it means is that the corpus has a defect someone must fix.
- **The PDF is rendered by the phone, not by the engine.** `packetToHtml`
  emits print-ready HTML and `expo-print` turns it into a PDF using the
  platform's own text shaping. A PDF written server-side with the wrong font
  does not fail — it emits blank boxes, and a lawyer receives a document with
  the client's own words silently missing. A packet can carry Devanagari,
  Tamil, Telugu, Bengali and Kannada in one paragraph, because the transcript
  is whatever the person actually said.
- **The packet's HTML must stay self-contained.** No script tag, no external
  stylesheet, no remote image. A document about someone's encounter with
  police must not make a network request when a lawyer opens it, from their
  office, months later. Two tests assert it and one of them checks that
  transcript text is escaped rather than rendered.
- **A rotation that is never finished is a leaked key that never expires.**
  The overlap in `KAVACH_API_KEYS` exists so a rotation does not lock every
  phone out at once. It is a window, not a setting. The boot banner says
  ROTATING for exactly as long as someone has not finished step two.
- **`currentFix` never prompts and never blocks.** It reads permission state
  rather than requesting it, caches for thirty seconds, and gives up after
  2.5s. A permission dialog appearing mid-encounter because a ten-second
  timer fired would be its own harm, and audio with no coordinates is worth
  far more than coordinates that cost audio.
- **An async test in a sync harness passes without running.** Making
  `evidence-service`'s harness accept promises without awaiting its existing
  calls meant `process.exit` fired while tests were still pending: one test
  vanished from the run and every group header printed before any result, while
  the suite still said green. `stt-service` carries a regression check for the
  same failure because it was bitten first. If a harness gains `await`, every
  call site needs it in the same change.
