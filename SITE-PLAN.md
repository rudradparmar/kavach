# Kavach website — build brief (v1)

Written 13 Oct 2026. Read `CLAUDE.md` first: every invariant there applies to the
site too. If anything below conflicts with `CLAUDE.md`, `CLAUDE.md` wins. Stop and
say so.

## What this is

A public **information site** for Kavach, with a **recorded demo**. It is not a web
version of the app and not a live tool. Nobody can use it during a real stop.
That property is what makes it OK to publish while the corpus is still unverified
(invariant 5). Do not add anything that changes it: no live microphone, no free-text
input to the engine, no API calls to the services.

Audience: funders, accelerators, government and civic-tech evaluators, potential
advocate partners, and the waitlist.

## Stack and hosting

- New top-level folder `site/`. **Astro**, static output (`output: "static"`), with
  no server adapter, no SSR and no serverless functions.
- Hosted on **Vercel** (Hobby). Root Directory is `site/`. Framework preset is Astro.
  Because the output is static, moving to Cloudflare Pages later is just a config
  change.
- Vercel must not need the engine or any of its dependencies to build. Generate the
  demo data locally and commit it (see Demo).
- Fonts: self-host Inter (or similar) plus **Noto Sans Devanagari**, so the Hindi
  lines render on every device. No Google Fonts request at runtime.
- No analytics, trackers, cookies, or third-party scripts except the waitlist form
  embed (invariant 7).

## Pages

1. **Home (`/`)**
   - Hero: a one-line problem statement and a one-line answer. Calm tone. Never
     confrontational (PRD Open Questions: an officer may be reading the screen).
   - "How it works", in 5 steps: one tap → it listens → it works out what kind of
     stop this is → it shows what the law says and the safest next step → it builds
     a record for a lawyer afterwards.
   - "How it stays safe": short cards based on `CLAUDE.md` invariants 1, 3 and 4.
     The AI never writes the law. De-escalation always comes first. If unsure, it
     says less, not more. Phrase these for a lay reader. Do not paraphrase them into
     stronger promises than the code keeps.
   - "Status": an honest line. *In development. The legal content is being prepared
     for review by a practising advocate and is not yet verified. The app is not
     available to the public.*
   - Waitlist call to action, plus a contact link for advocates and partners.
2. **Demo (`/demo`)**: see below.
3. **About / Status (`/about`)**: who is building it (Rudra, solo), why, the
   roadmap at headline level (website → advocate review → closed field test →
   Android app), and what "not yet verified" means.
4. **Privacy (`/privacy`)**: what the waitlist form collects, who processes it
   (the form provider), and how to ask for deletion. Plain language; India's DPDP
   Act applies.

Footer on every page: *"Rights information, not legal advice. Legal content is
unverified and under development."*

## Demo

### Generation (local, committed)

- `site/scripts/build-demo.ts` imports the real engine (`kavach-engine/src/engine/session.ts`)
  with the **mock** provider and replays each fixture in
  `kavach-engine/fixtures/transcripts/`. It follows the same loop as
  `kavach-engine/src/cli/replay.ts`. For each turn it writes the speaker, the text,
  and the engine's `GuidanceUpdate` fields: scenario title, fallback state, new
  flags (severity and statement), ranked options with the safest one marked,
  `documentNow`, and the provisions.
- Output goes to `site/src/data/demo/<fixture-id>.json`. Commit it.
- Add `npm run demo:build` to `site/package.json`. Run it with `tsx` from the repo
  root so the engine's relative corpus path resolves.
- **Fail the generation** if any turn returns guard violations. A demo built on a
  tripped guard shows a defect as if it were the product.
- Include the English and Hindi traffic-stop fixtures as a minimum.

### Masking (public build)

The corpus is placeholder law. A public page reaches far more people than an app
locked behind a key, and screenshots travel. So the generator masks content at
generation time:

- Section numbers and provision citations → `§ — pending advocate review`
- Quotable lines (EN and HI) → `[Line shown here once an advocate has reviewed it]`
- Flag statements, option labels, scenario titles and `documentNow` stay as they
  are. They show the mechanism without citing law.

Do not compose any replacement legal wording. Masking only removes text; it never
writes new legal content (invariant 1).

### Presentation

- The visitor picks a scenario and steps through it turn by turn with
  Next/Previous. No autoplay and no audio (see HANDOFF on auto-play).
- Each frame shows the officer or user line, the scenario as the engine classified
  it, any flags (shown by icon, colour and word, as in the app), and the ranked
  options with the safest one dominant.
- A persistent banner on every frame: **"Recorded demo of the engine using placeholder
  content. Not legal advice. Do not use during a real stop."**
- Label the speech as a scripted transcript. Never say "listening" or imply real
  speech recognition.

## Copy rules (hard)

- No section numbers, act names with section numbers, or "the officer cannot…"
  statements anywhere on the site.
- Nothing that tells anyone to resist, refuse, flee or challenge (invariant 3).
- No "continuous recording", "always on", or "evidence that can't be deleted"
  claims. See HANDOFF: capture is chunked, and foreground-only today.
- No testimonials, user counts, or press logos (none exist).
- No outcome promises ("avoid fines", "win your case").
- "Kavach" is a working name. Keep it in one constant (`site/src/config.ts`) so a
  rename is a one-line change.

## Waitlist

- Embed a Tally form (free, no backend needed). Read the form URL from
  `site/src/config.ts` and use a placeholder until Rudra supplies the real one.
- Fields: email (required), role (individual / lawyer / NGO / government /
  investor / other), optional note. Nothing else.

## Checks (all must pass before deploying)

1. `cd site && npm run build` succeeds, with no warnings about missing data.
2. `site/scripts/check-dist.ts` fails if `site/dist/` contains:
   - any `section` string or provision id from `kavach-engine/corpus/provisions.json`
   - any quotable line text from the scenario files
   - any `<script src>` other than the waitlist embed's domain
   Add it to `npm run build` (as a postbuild step).
3. Lighthouse mobile scores ≥ 90 for Performance, Accessibility and Best Practices.
   Layout works at 360px with no horizontal scroll. Devanagari renders.
4. The root `npm run verify` still passes, so nothing outside `site/` changed
   behaviour.
5. Add a `site` job to CI that runs `demo:build` and fails if the committed JSON is
   stale (`git diff --exit-code site/src/data/demo`), then runs the build.

## Out of scope for this pass

- Hosting the engine/STT/evidence services (needs a persistent disk, see
  `deploy/README.md`).
- Any interactive or live use of the engine from the browser.
- The Android app, domain purchase and final name.

## Deploy

1. Push to `origin/master` (private GitHub repo).
2. Vercel → Add New → Project → import `rudradparmar/kavach` → Root Directory
   `site` → Framework Astro → Deploy.
3. Use the `*.vercel.app` URL until the name is decided; add a custom domain after.
