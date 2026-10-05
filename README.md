# Kavach

A rights-in-the-moment agent for India. A person stopped by police taps once;
the app listens, works out what kind of encounter it is, tells them what the
law says, flags conduct that appears unlawful, offers ranked actions, and
produces a packet for a lawyer afterwards.

---

## Read this before deploying it to anyone

**The legal corpus is unverified placeholder content. No advocate has read any
of it.** Every section number was taken from a table in the PRD and has not
been checked against a bare act. The product says so on every screen, in every
packet, and in the boot banner of every service — but a user standing in front
of a police officer, repeating a sentence this app gave them, is not protected
by a banner.

There is one gate, and it is not an engineering task:

1. Engage a named advocate.
2. Check every provision against a bare act, gazette notification, or reported
   judgment. No blog, no news article, no SEO page (PRD R6).
3. Review every quotable line for **escalation risk**, separately from legal
   accuracy. A line that is legally correct and gets someone hit is a failure.
4. Answer the liability question the PRD leaves open: what happens if a user
   is charged with obstruction after repeating a line this app gave them. That
   question gates whether the quotable line ships at all.
5. Set `kavach-engine/corpus/meta.json` status to `counsel-signed-off` with the
   advocate's name and the date.

Until step 5, `npm run preflight` reports a blocker and the deployment is for
engineering only.

---

## What it is

Four pieces, three of them deployable services.

| | |
|---|---|
| `kavach-engine/` | The headless core. Corpus, deterministic rules, output guard, session state, lawyer packet, escalation drafts. This is the part an advocate reads. |
| `stt-service/` | Audio in, words out. Separate on purpose — see below. |
| `evidence-service/` | Chunk custody. Server-side timestamps and hashes, so a recording outlives the handset. |
| `app/` | Expo / React Native client. |
| `shared/` | Auth, rate limiting, lifecycle. Imported by all three services. |
| `deploy/` | One origin, three services behind a path-routing proxy, over a Cloudflare Tunnel. |

**The model never authors a legal claim.** The LLM picks a scenario id from a
fixed enum and reports facts it can quote verbatim. Every provision, every
quotable line, every "the officer cannot do this" comes out of a versioned
corpus. Three independent layers reject anything else. `CLAUDE.md` has the
full list of invariants; `docs/engine-architecture.md` explains why.

Speech lives in its own service for the same reason: an advocate reading
`kavach-engine/` should find corpus, rules and a guard, and nothing else. A
`/transcribe` route on the engine would have been less work, which is the
reason not to do it.

---

## Run it locally

Node 20+. No build step — everything runs under `tsx`.

```bash
for d in kavach-engine stt-service evidence-service app; do (cd "$d" && npm install); done

cd kavach-engine    && npm run dev   # :8787
cd stt-service      && npm run dev   # :8788
cd evidence-service && npm run dev   # :8789
```

Auth is **on** by default. The three services generate a shared
`.kavach-secrets.json` at the repo root on first boot and read it thereafter,
so this works with no configuration and is still secure. Making the
zero-config path the insecure one is how services end up deployed wide open.
`KAVACH_AUTH=0` exists, is explicit, and prints a warning on every boot.

No API key is needed. The default classifier is a deterministic keyword
matcher, the default speech provider is a mock that cannot hear and says so.

Then, from `app/`:

```bash
npm start          # Expo Go; the engine address is derived from the Metro host
```

---

## Verify it

```bash
npm run verify     # from the repo root: every check that does not need a server
```

Or piece by piece:

```bash
cd kavach-engine && npm run validate && npm test && npm run eval
cd evidence-service && npm test
cd stt-service && npm test
cd app && npm run typecheck && npm run units
```

With the three services running, from `app/`:

| | |
|---|---|
| `npm run smoke` | Guidance loop and the packet |
| `npm run pipeline` | Perception: audio → transcript → guidance, English and Hindi |
| `npm run evidence` | Custody chain: upload → hash → playback → delete |
| `npm run auth` | A token for one encounter is refused on another, on all three services |
| `npm run afterwards` | Officer details, escalation drafts, debrief, packet completion |
| `npm run preflight` | **Is this deployment fit for the public?** |

These drive the app's own client modules, not a reimplementation of them, so a
break in either boundary shows up without a device to hand.

`auth` and `preflight` both make deliberate failed-credential requests, and
the rate limiter charges a token for each (capacity 20, refilling 10/minute).
Run them several times back to back and the service starts answering 429 where
the script expected 403, which fails in a way that reads exactly like an auth
bug. Wait a minute and re-run before believing it.

`npm run preflight -- https://api.your-domain.example` is the one to run
against a real deployment. It reports blockers and warnings separately and
exits non-zero on any blocker.

---

## Deploy it

`deploy/` has the full guide. The short version:

```bash
cp deploy/.env.example deploy/.env    # fill in the keys and the tunnel token
cd deploy && docker compose up -d --build
cd ../app && npm run preflight -- https://api.your-domain.example
```

Three services behind one Caddy instance that routes by path (`/engine`,
`/stt`, `/evidence`) and strips the prefix, reached over a Cloudflare Tunnel.
No inbound port is opened; TLS terminates at the edge with a real certificate.
The client derives the other two addresses from whichever one the engine is
at, so Settings takes one URL rather than three.

**The host needs a real, persistent filesystem.** Both stores assume one and
neither says so when it is missing: the engine restores `0 sessions` and
carries on, and evidence-service returns a clean 404 for audio that used to
exist. On an ephemeral disk, the service whose entire purpose is that a
recording outlives the handset fails silently and looks healthy. Oracle Cloud
Always Free was chosen for the disk rather than the CPU; anything always-on
with a real volume works.

### What the deployment needs from you

Only keys. Everything else has a working default.

| | |
|---|---|
| `KAVACH_API_KEY`, `KAVACH_SESSION_SECRET` | Required. Identical across all three services. `openssl rand -base64 24 \| tr -d '=+/'` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Required for the tunnel. |
| `KAVACH_STT_*` | Optional. Without it, speech is simulated and the app says so in four places. Groq's free tier fits the existing provider with no code change. |
| `ANTHROPIC_API_KEY` | Optional. Without it, classification is the deterministic keyword matcher — the offline baseline any model has to beat, and a reasonable thing to deploy. |

### Rotating keys

Two steps, and the second one is the one people skip.

1. New key in `KAVACH_API_KEY`, old key in `KAVACH_API_KEYS`. Both work. Ship
   the new key to clients.
2. Empty `KAVACH_API_KEYS`. The old key stops working.

The overlap exists because PRD R1 forbids a login, so there is no account to
push a new key to and changing it in one step locks every installed app out at
the same instant. A rotation left half-finished is a leaked key that never
expires. `KAVACH_SESSION_SECRETS` works the same way for session tokens.

---

## What is still missing

Not defects — known, deliberate, and each one blocked on something specific.

**Blocked on a person, not on code.** The corpus sign-off and the liability
question above. Nothing reaches a user until both are closed.

**Blocked on leaving Expo Go.** Three limits point the same way and a
development build buys all three at once: gapless capture (`expo-audio` has no
segmented mode, so rotation loses the milliseconds between chunks), background
capture (Android needs a foreground service), and the lock-screen widget the
PRD asks for in R1. What survives today is what the evidence service already
acknowledged, which is what R4 actually promises — but a chunk sequence is not
continuous audio and must never be described to a lawyer as if it were.

**Blocked on a key.** Real transcription. Point `KAVACH_STT_PROVIDER` at
Whisper and measure: code-mixed Hindi-English, roadside noise, and what upload
actually costs on a weak network are all unknown until it runs on a real
network. The latency readout on the session screen exists for exactly this.

**Blocked on a server-side sender.** R5's "one tap sends". `expo-sms` cannot
send silently and Android never reports a result, so the two channels, the
message and the contacts all exist and only the sending is manual.

**Not blocked, just absent.** Per-user identity — two people sharing a
deployment share an instance key. Real multi-tenancy needs an identity model
the PRD has not asked for.

Fact extraction runs in Latin and Devanagari only. The five languages added
for R12 classify correctly and show their quotable line, but establish no
facts, so a session in Tamil gets its scenario and no misconduct flags. That
is suppression rather than invention, which is the safe direction, and it is
the reason those cues were not machine-extended: a fact extracted backwards
defeats every layer below it.

---

## Where the documentation is

| | |
|---|---|
| `CLAUDE.md` | The invariants. Read before changing anything. |
| `HANDOFF.md` | Current state, every decision made and why, and the traps. |
| `Kavach-PRD-v1.md` | The product spec. |
| `docs/engine-architecture.md` | Why the engine is shaped the way it is. |
| `deploy/README.md` | Deployment in detail. |
| Each service's `README.md` | Its own contract. |
