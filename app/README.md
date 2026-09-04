# Kavach client

The Expo / React Native shell over `kavach-engine`. One tap starts a session;
turns go in by voice or by typing; the `GuidanceUpdate` that comes back is
rendered.

> **The corpus this renders is UNVERIFIED.** Every section number is a
> placeholder. No advocate has reviewed any of it. The app shows a banner
> saying so on every screen, and that banner is keyed off the engine's
> `/health` response — it disappears when the corpus status becomes
> `counsel-signed-off`, and there is no way to turn it off before then.

---

## Run it

Four processes. The engine first:

```bash
cd kavach-engine
npm install
npm run dev                 # :8787
```

Speech, which is optional — without it the microphone is disabled and typing
still works exactly as before:

```bash
cd stt-service
npm install
npm run dev                 # :8788
```

Evidence custody, also optional — without it recording still happens and
queues on the phone, but nothing gets off it:

```bash
cd evidence-service
npm install
npm run dev                 # :8789
```

Then the app:

```bash
cd app
npm install
npm start                   # scan the QR with Expo Go
```

The phone and the laptop must be on the same network.

> The default speech provider is `mock`: it **cannot hear**, and returns canned
> lines. The app says so on the start screen and above every transcript. Point
> `KAVACH_STT_PROVIDER` at a real endpoint to actually transcribe — see
> `stt-service/README.md`.

### The access key

The services require a bearer token on everything except `/health`. On first
boot they generate `.kavach-secrets.json` at the repo root and print where
their secrets came from; copy `apiKey` from it into **Settings → Access key**
on the phone, once. `EXPO_PUBLIC_KAVACH_API_KEY` works too.

Without it the engine will not start a session, and the app says so rather than
looking broken. There is still no login — PRD R1 forbids one — this is a
deployment credential, not an account. When a session starts the engine mints a
**session token** for it, and the app carries that to all three services; it is
a capability for that one encounter and is never persisted.

### Finding the engine

The app resolves the engine address in this order:

1. A value saved in Settings (the gear on the start screen).
2. `EXPO_PUBLIC_KAVACH_URL` in `.env`.
3. **The Metro dev-server host with the port swapped to 8787.**

(3) is the one that usually applies and needs no configuration — the phone
already knows the IP of the machine serving the bundle, and that is normally
the same machine running the engine. If the laptop moves networks, it keeps
working.

When it does not, Settings has a **Test connection** button that reports the
provider, corpus version and status. It exists to separate "wrong address"
from "engine is not running", which otherwise look identical.

## Check it without a phone

```bash
npm run units        # pure logic, plus static-option parity with the engine
npm run smoke        # guidance loop + the packet, against a live engine
npm run pipeline     # perception loop: audio bytes -> transcript -> guidance
npm run evidence     # custody chain: upload -> hash -> playback -> delete
npm run auth         # cross-service authorisation, all three running
npm run typecheck
```

`scripts/smoke.ts` drives `src/api/client.ts` — the same code the app runs —
through a fixture transcript and prints what each screen would render:
scenario, accumulated flags, the quotable line in both languages, the ranked
options with the safest marked. It then builds the packet from that same
session and checks it — including that the unverified warning survives into
both the JSON and the markdown an advocate would actually receive.

`scripts/pipeline.ts` goes one layer further out, posting audio to
`stt-service` and feeding the transcript to the engine, so a break in either
boundary shows up here rather than on a device. It also runs the script parity
check described below.

`scripts/units.ts` covers the logic with nothing behind it — voice-language
matching, the latency percentiles, URL normalisation — plus the static-option
parity check described under offline cards. Voice matching in particular fails
silently and in one direction: too strict a matcher greys out the Hindi button
on a device that can speak Hindi, and nobody notices without a Hindi handset to
hand.

```bash
npm run smoke -- http://localhost:8787 ../kavach-engine/fixtures/transcripts/ambiguous.json
npm run pipeline -- http://localhost:8787 http://localhost:8788
```

These import the real client modules, which is why `src/api/url.ts`,
`src/stt/client.ts`, `src/tts/languages.ts`, `src/offline/staticOptions.ts`
and `src/evidence/client.ts` carry no React Native imports — anything a script needs to exercise has to stay
runnable under plain Node.

## Speech

The microphone is one implementation of the engine's contract. The text box is
the other. Both produce the same thing — plain text plus a speaker label — and
nothing downstream can tell which was used. The text composer is not a fallback
bolted on beside the microphone; it is the offline baseline that still works
with no signal, no permission, and no transcription service.

- **Hold to speak.** A held button cannot be left recording by accident, and
  releasing is the same motion as lowering the phone.
- **`LOW_QUALITY` capture.** 64kbps mono m4a transcribes as well as 128kbps
  stereo and uploads in half the time. The upload sits directly inside the
  PRD's 8-second budget.
- **No confirmation step.** The transcript goes straight to the engine. The
  engine's confidence floor is the safety net for bad perception — a garbled
  transcript classifies to the fallback and the user gets the universal safe
  actions, which is the correct outcome. An extra tap costs more than it buys
  inside a ninety-second encounter.
- **What was heard is shown**, verbatim, above the guidance built on it. Every
  layer below trusts the transcript, and the engine's rejection layers protect
  against a model inventing law — not against a microphone mishearing a
  sentence. Only the user can catch that one.
- **Speech cannot tell who is talking.** The speaker toggle stays a human
  decision; a guessed attribution in a lawyer's packet is worse than an honest
  `unknown`.

### Script parity

Speech recognition writes Hindi in Devanagari. The corpus cues were romanised
Latin only (`chaabi`, `paise`, `thane chalo`), so the same sentence classified
two different ways and a Hindi speaker got the fallback on every turn:

| transcript | before | now |
|---|---|---|
| `Digital nahi chalega. Chaabi do.` | `keys-taken` | `keys-taken` |
| `डिजिटल नहीं चलेगा। चाबी दो।` | **fallback** | `keys-taken` |

The corpus now carries both scripts, and `npm run pipeline` **fails the run**
if they ever diverge again — a Hindi speaker silently dropped to the safe
actions is the kind of failure that reports as working.

`stt-service` still biases the provider towards Latin and still reports the
script it got, and the app still surfaces `classifierScriptMismatch`. Those
stay as a backstop for scripts the corpus does not cover — the PRD's language
expansion list (R12) is Tamil, Telugu, Bengali, Marathi and Kannada, and each
one arrives with this same problem until its cues are written.

## Reading the line aloud (PRD R3)

The quotable line has a `▶ Play` control per language. This is the highest-risk
output in the product — the user does not hear it and act privately, they
repeat it out loud to a police officer — so three rules are enforced in
`src/tts/speech.ts` rather than left to callers:

- **Never speak unasked.** Playback is always a deliberate tap. A phone that
  starts talking by itself mid-encounter is a variable the user cannot take
  back, and the officer can hear it too.
- **Never speak a language the device cannot pronounce.** Availability is read
  from `getAvailableVoicesAsync()` and each control is disabled with a reason
  where there is no voice. Android will otherwise hand Devanagari to an English
  engine and produce confident gibberish — which the user then says aloud. A
  disabled button that explains itself is a good outcome; a mangled Hindi line
  is not.
- **Slow enough to repeat.** `rate: 0.78`, tuned for a frightened person saying
  the sentence back, not for sounding natural.

Playback stops the moment the guidance underneath it changes, and when the
session ends. A line still playing after the scenario moved is a sentence being
said to an officer with nothing on screen that still supports it.

Text is never replaced by audio. Both languages stay on screen throughout.

## Works with no signal (PRD R10 + R1)

The whole corpus (~32KB) is cached in AsyncStorage, stamped with the version it
came from and refreshed when `/health` reports a different one. The version
stamp is not just freshness: PRD R6 requires every answer to record which
corpus produced it, so a cache that silently served an old version would break
that trail. A stale cache is served rather than nothing, and says so.

The ten scenarios sit as large tap targets **below the fold** on the start
screen. PRD R1 contradicts itself — "no scenario picker" on one line, "the 10
covered scenarios are reachable as large tap targets on the first screen" for
someone who cannot speak on another — and position satisfies both: START is
still the only thing on first paint, so the fast path is unchanged.

A card is deliberately **less** than a live session and says so on the card
itself. No turn has happened, so no fact is established, so no misconduct rule
can have fired and no custody clock is running. Presenting it as live guidance
would claim the engine had assessed a situation it has never seen.

`src/offline/staticOptions.ts` is a **port** of the engine's `buildOptions`,
which cannot be bundled because it reaches `corpus/loader.ts` and therefore
`node:fs`. Two traps it exists to avoid, both easy to hit by reading the corpus
JSON naively:

- `rank` and `safest` in the corpus are *inputs to ordering*, not the answer —
  the engine re-ranks from scratch. `search-frisk` carries two `safest: true`
  entries for exactly this reason.
- An option with unmet `requires` is not offered. On a static card nothing is
  ever established, so — following the engine's rule that `unknown` satisfies
  no predicate — every gated option is dropped. That is what withholds "ask for
  a female officer" from a card being read by someone the app knows nothing
  about.

`npm run units` runs the port and the real `buildOptions` side by side over all
ten scenarios. It is the one place the app imports engine *runtime* code rather
than types, deliberately: a parity check against a copy would be worthless.

## Evidence capture (PRD R4)

Capture starts with the session, not on a separate tap — R4 is "continuous
audio from session start", and an opt-in means the evidence is missing exactly
when somebody forgot to press it.

### One microphone, two consumers

There is one mic and two things want it: continuous capture and hold-to-speak.
Two recorders at once do not work, so `src/evidence/useCapture.ts` owns the
device and both go through it, on one primitive — **rotation**. Stop, take the
file, start a new one.

Evidence rotates on a ten-second timer. Hold-to-speak rotates twice out of
band, once on press and once on release, and the chunk between them *is* the
utterance. That segment goes to transcription **and** into the evidence queue,
so nothing the user says is missing from the record because they were talking
to the app.

### The queue

Every chunk is encrypted with **AES-256-GCM** (`expo-crypto`) using a key held
in the platform keystore (`expo-secure-store`) — never in AsyncStorage beside
the data it protects — and written to the cache directory. The plaintext
recording is deleted immediately.

A chunk leaves the device only after the service acknowledges it. An optimistic
delete is the exact failure this path exists to prevent. The queue drains on
every new chunk and on a 15-second timer, survives app restarts, and reconciles
against `GET /acks` on resume so a phone that died mid-upload does not resend.

### Told plainly

`EvidenceStatus` shows two counts, never a percentage: "12 safely off this
phone, 3 still on it — if the phone is taken now, those are gone." R4 requires
the user be told plainly that evidence is not yet safe, and "80% uploaded" is
not something a frightened person can act on. Recording is always visibly
indicated; there is no covert capture.

### What it cannot do in Expo Go

Both of these are real and neither is papered over:

- **Rotation leaves a gap.** `expo-audio` records to a single file and has no
  segmented mode, so stopping and restarting loses the milliseconds in
  between. Gapless segmentation needs a native module. A transcript assembled
  from these chunks is not continuous audio — do not describe it to a lawyer as
  if it were.
- **Capture is foreground-only.** Background recording on Android needs a
  foreground service, which Expo Go cannot carry. If the app is backgrounded or
  the phone locked, capture stops — and what survives is what the service
  already acknowledged, which is exactly the guarantee R4 states.

Deletion removes both halves: the device queue and the service. Evidence
removed from one place has not been removed.

## Trusted-contact alert (PRD R5)

Contacts are configured on the start screen, which nags when the list is empty
— R5 says "before the product is ever needed", and nobody types a phone number
mid-encounter. An **Alert** button sits in the session header on every guidance
frame, because the corpus itself ranks "send the trusted-contact alert" as an
action in several scenarios.

The message is shown before it goes anywhere. That costs a tap against R5s
"one tap sends", and it buys the user seeing exactly what their sister is about
to read, their live coordinates included. A location fix and a police-encounter
summary are not things you can unsend.

Three rules govern the text, all enforced in `src/contacts/message.ts` and
asserted in `npm run units`:

- **It states no law.** No provision, no section number, and none of the
  misconduct flags — not even the UNLAWFUL ones. It goes to someone who was not
  there, who may forward it, and who may read it out to the officer. "The
  police are acting illegally", sourced from unverified placeholder corpus, is
  a claim this app cannot stand behind and the user would be left holding.
- **The classification is a guess, not a fact.** The engine can misclassify —
  that is what the confidence floor is for — so the line is attributed
  ("what the app thinks is happening (it may be wrong)"), and a low-confidence
  session says it could not work out the situation rather than inventing one.
- **Zero context, no install.** A plain Google Maps URL any phone opens, the
  users name up front, and no jargon.

### What it does not do

R5 asks for "delivery via at least two independent channels (SMS + data)".
Both are here — SMS over cellular, the share sheet over data — and when one
network is down the other usually is not, which is the property R5 is after.

**But nothing sends automatically.** `expo-sms` cannot send silently; it
opens the platform composer prefilled, and a human taps send. On Android its
result is always `unknown`, so there is no delivery confirmation either. R5s
"one tap sends" and the >=98% delivery-receipt metric both need a server-side
sender with real credentials, which is out of scope.

That limit is stated on the contacts screen and again on the alert sheet at the
moment of sending, not just here. A user who believes the alert went by itself
will not check that it did.

## The lawyer packet (PRD R8)

Ending a session offers the packet rather than binning the encounter. The
engine holds sessions in memory, so walking away from that screen is how the
record gets lost — a session with no turns is the only case that goes straight
back to the start, because there is nothing to hand anyone.

It renders from the packet **JSON**, not the markdown, so flags and provisions
go through the same components as the live screens. An advocate should not be
reading a differently-styled account of the same facts, and a second renderer
would be a second place for corpus text to drift.

`unverifiedContentWarning` is the first thing on the screen. An advocate has to
know the provisions are placeholders *before* reading them, not after.

Export writes markdown to the cache directory (`expo-file-system`) and hands it
to `expo-sharing`. Sharing asks first, every time, in plain terms: the packet
contains a verbatim transcript of an encounter with police, and once it leaves
the device it cannot be recalled. Nothing is uploaded automatically — the only
way this record moves is a deliberate tap.

## Latency

`src/telemetry/latency.ts` measures capture → transcribe → engine → guidance
and shows the total on the session screen against the PRD's 8s p95 budget.

The readout says "tap to guidance", not "tap to first spoken word". Because
playback is a deliberate tap, the gap between the two is mostly the user
reaching for the button, which is not ours to time. The synthesis half is
measured separately and shown beside the control that triggers it, so the two
halves are visible without either being passed off as the PRD's figure.

Nothing is sent anywhere and nothing counts how often the app is opened; PRD
anti-metrics forbid DAU, session length and retention.

## Where the engine contract comes from

`src/api/types.ts` does not copy the engine's types. It re-exports them
through a `@engine/*` path alias pointing at `../kavach-engine/src/`, using
`import type` / `export type` only.

Babel erases type-only imports entirely, so nothing from the engine package is
bundled into the app — but TypeScript still checks against the real
definitions. Change `GuidanceUpdate` in the engine and this app stops
typechecking. That is the point: a client that silently drifts from the engine
contract is a client that renders stale guidance.

## What this does not do

Deliberately absent, and next in roughly this order:

- Lock-screen widget and panic-mode entry (PRD R1) — needs a native module,
  which also means leaving Expo Go.

## Rules this client holds to

It renders. It does not decide.

- **No text in this app states what the law is.** Every provision, quotable
  line, option label, rationale and disclaimer is a string from the engine,
  rendered verbatim. Nothing here rewrites, summarises, translates or
  supplements corpus content.
- **The disclaimer renders on every guidance frame**, from
  `update.disclaimer`, with no way to dismiss it (PRD R7).
- **The fallback stays bare.** When `update.fallback` is true the screen says
  the situation was not confidently identified and shows the universal safe
  actions. It adds no legal detail. Its emptiness is the feature — do not
  improve it.
- **Flags accumulate.** `GuidanceUpdate.newFlags` is only what fired on that
  turn, but a flag does not stop being true because the conversation moved on.
  `App.tsx` keeps the running set; the newest renders at full weight.
- **Severity is never colour alone.** Icon, colour, and the word itself —
  because colour fails in direct sunlight and for a colourblind user.
- **A tripped output guard is surfaced, not swallowed.** If the engine
  degrades a turn to the safe actions, the app says so. That signal means
  corpus wording needs fixing, and the fix is always to reword the corpus,
  never to loosen the guard.
- **The alert states no law.** It goes to a third party who may forward it or
  show it to the officer, and it would be quoting unverified placeholder text.
- **A packet never leaves the device without being asked for.** Nothing is
  uploaded automatically, and the confirm names what is in it.
- **A simulated transcript is never passed off as real speech.** The mock STT
  provider is called out on the start screen and above every transcript it
  produces. Guidance built on canned text describes a situation that is not
  happening, which is the worst thing this pipeline can do.
- **Nothing is spoken that the device cannot pronounce, and nothing is spoken
  unasked.** A mispronounced Hindi line is worse than a silent button, because
  the user repeats it to an officer.

## Layout

```
App.tsx                  shell; owns the audio -> words -> turn -> guidance pipeline
src/api/
  auth.ts                instance key storage; the session token is never stored
  client.ts              createSession · sendTurn · getHealth, with timeouts
  config.ts              base URL resolution and persistence
  url.ts                 platform-free URL helpers (so scripts/ can import them)
  types.ts               type-only re-export of the engine contract
src/stt/
  client.ts              transcribe · getSttHealth — no React Native imports
  storage.ts             speech service address persistence
  useRecorder.ts         expo-audio capture, permissions, duration
  types.ts               the transcript contract
src/tts/
  languages.ts           which languages the device can pronounce (no RN imports)
  speech.ts              expo-speech playback, voice availability, timing
src/evidence/
  useCapture.ts          the one microphone owner; rotation for both consumers
  queue.ts               AES-GCM queue, drains only on acknowledgement
  client.ts              upload, acks, manifest, delete — no RN imports
src/contacts/
  message.ts             what a contact receives — pure, states no law
  location.ts            a fix, raced against a deadline the API does not give
  send.ts                SMS + share sheet, honest about what they guarantee
  storage.ts             contacts and the users name
src/offline/
  corpusCache.ts         the corpus on the device, version-stamped
  staticOptions.ts       port of engine buildOptions; pinned by units.ts
src/telemetry/
  latency.ts             per-turn spans and the PRD budget comparison
src/components/
  Banners.tsx            UNVERIFIED banner · disclaimer
  QuotableLine.tsx       PRD R3 — English at display size, Hindi beneath
  Flags.tsx              accumulated misconduct flags, newest emphasised
  Options.tsx            ranked actions, safest visually dominant
  Guidance.tsx           one GuidanceUpdate, composed
  AlertSheet.tsx         review the alert, then pick a channel
  Composer.tsx           hold-to-speak + text, one contract, two inputs
  EvidenceStatus.tsx     how much is off the phone, in counts not percentages
  TurnStatus.tsx         what was heard, and how long it took
src/screens/
  StartScreen.tsx        one tap target (PRD R1)
  SessionScreen.tsx      live guidance + the composer
  ScenarioCardScreen.tsx one scenario, static, works offline
  PacketScreen.tsx       the lawyer packet, rendered + exportable
  ContactsScreen.tsx     trusted contacts, set up before they are needed
  SettingsScreen.tsx     engine address + health probe
scripts/
  units.ts               pure logic + static-option parity against the engine
  smoke.ts               guidance loop + packet checks against a live engine
  pipeline.ts            audio -> transcript -> guidance, plus the script check
  evidence.ts            upload -> hash -> playback -> delete, against the service
  auth.ts                containment across all three services
  creds.ts               reads the generated key so scripts stay zero-config
```
