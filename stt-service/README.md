# kavach-stt-service

Turns audio into words. That is all it does.

```
POST /transcribe   raw audio bytes -> { text, script, provider, simulated, ... }
GET  /health       provider, model, whether it can actually hear   (open)
```

`/transcribe` needs a bearer token — a session token from the engine, or the
instance key. Audio of an encounter is being handed over, so it is not an open
endpoint. See `shared/README.md`.

```bash
npm install
npm test          # 11 assertions
npm run dev       # :8788
```

---

## Why this is a separate service

It would have been less work to add a `/transcribe` route to `kavach-engine`.
That is exactly the reason not to.

CLAUDE.md's first invariant is that the model never authors a legal claim, and
the engine's whole shape exists to make that auditable: a versioned corpus,
deterministic rules, three independent rejection layers, and no model output
that is not a scenario id or a quoted fact. An advocate reading
`kavach-engine/` should find nothing else in it. A speech model sitting next to
that code makes the boundary a comment rather than a fact about the repository.

So the split is physical. This service reads no corpus, imports nothing from
the engine, and does not know what a scenario is. It receives bytes and returns
words. Everything that decides what those words *mean* lives on the other side
of an HTTP call.

The PRD's open question about where evidence lives and who can be compelled to
produce it also applies to audio and not to text guidance. Those want to be
separately deployable.

## Providers

Set with `KAVACH_STT_PROVIDER`. See `.env.example`.

**`mock`** (default) — cannot hear. Returns canned romanised lines cycling
through the canonical escalation, so the whole pipeline is runnable with no API
key, no network and no cost. Every response is marked `simulated: true` **and**
the text itself carries a `[SIMULATED]` marker, because a canned transcript
silently treated as real speech would produce confident guidance about a
situation that is not happening. The client shows both.

**`openai-compatible`** — POSTs to any `/v1/audio/transcriptions` endpoint.
One implementation covers OpenAI, Groq, and a self-hosted whisper.cpp server.
Written against the generic shape rather than a vendor SDK specifically so that
"the audio never leaves a machine we control" stays reachable without a
rewrite.

```bash
KAVACH_STT_PROVIDER=openai-compatible \
KAVACH_STT_URL=https://api.openai.com/v1/audio/transcriptions \
KAVACH_STT_KEY=sk-... \
npm run dev
```

## The script problem

This is the reason the response carries a `script` field.

Whisper transcribes Hindi speech into **Devanagari**. The engine's
`classifierCues` were **romanised Latin** — `chaabi`, `paise`, `thane chalo` —
so the identical utterance classified completely differently depending on which
script it arrived in:

| transcript | before | now |
|---|---|---|
| `Digital nahi chalega. Chaabi do.` | `keys-taken` | `keys-taken` |
| `डिजिटल नहीं चलेगा। चाबी दो।` | **fallback** | `keys-taken` |

Wiring speech in naively would have made the product silently useless for Hindi
speakers — most of the people it exists for — while looking like it worked:
every turn quietly degrading to the universal safe actions with nothing saying
why.

**The corpus now carries both scripts**, and `app/`'s `npm run pipeline` fails
the run if they diverge again.

What remains here is a backstop, not a workaround:

1. A **romanisation prompt** biasing the provider towards Latin script. A soft
   bias, not a guarantee — and now belt-and-braces rather than load-bearing.
2. A reported **`script`** and **`classifierScriptMismatch`**, so that a script
   the corpus does *not* cover surfaces as "the transcription was correct, the
   classifier could not use it" rather than as an apparently broken product.

That second one keeps earning its place: PRD R12 adds Tamil, Telugu, Bengali,
Marathi and Kannada, and every one of them arrives with exactly this problem
until its cues are written.

## Wire format

The request body is **raw audio bytes**, not multipart — both ends of this wire
are ours, and a hand-rolled multipart parser is a pointless place to spend
correctness. The outbound call to the provider *is* multipart, built with the
platform `FormData`.

```
POST /transcribe?language=hi&romanise=true&filename=turn.m4a
content-type: audio/m4a

<bytes>
```

```json
{
  "text": "Digital nahi chalega. Chaabi do.",
  "script": "latin",
  "provider": "mock",
  "model": null,
  "language": "hi",
  "providerMs": 0,
  "totalMs": 0,
  "bytes": 4096,
  "simulated": true,
  "classifierScriptMismatch": false
}
```

`language` is a hint, not a lock. Indian roadside speech is routinely
Hindi-English code-mixed, and forcing the wrong language is worse than letting
the provider decide.

## What this does not do

- **Chunked streaming upload (PRD R4).** Audio is sent once, after the button
  is released. Evidence that survives phone seizure needs chunks uploaded and
  acknowledged every 10 seconds, which is a different service with different
  durability requirements.
- **Store anything.** Audio is transcribed and dropped. Nothing is written to
  disk. The evidence pipeline is a separate concern and deliberately not
  entangled with this one.
- **Diarisation.** It cannot tell who was speaking. The client carries a
  speaker toggle for that, because a guessed attribution in a lawyer's packet
  is worse than an honest `unknown`.
