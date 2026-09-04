# PRD: Rights-in-the-Moment Agent

**Working name:** Kavach *(placeholder — see Open Questions)*
**Version:** v1 draft
**Date:** 13 August 2026
**Scope:** India, central law only
**Status:** Draft for review — all legal citations pending verification by qualified counsel

---

## Problem Statement

When an Indian civilian is stopped by a traffic constable, detained at a protest, or questioned by police, the power asymmetry is almost total: the officer knows (or asserts) the law, and the civilian does not. This produces routine, well-documented harm — inflated on-the-spot "fines," vehicle keys pulled from ignitions without any legal basis, detentions past the 24-hour limit, and force used on peaceful assemblies. A rider stopped without a helmet faces a **₹1,000** statutory penalty under Section 194D of the Motor Vehicles Act; being told it is ₹5,000 and paying in cash is a transaction that happens thousands of times a day.

The people most exposed — students, gig workers, migrants, first-time riders — are precisely those least able to absorb the cost and least likely to have a lawyer's number saved. The window in which knowing your rights actually matters is **30 to 90 seconds long**, happens without warning, and happens while the person is frightened.

Existing resources fail on timing, not content. Rights information exists in PDFs, NGO handbooks, and legal blogs — all of which assume a calm reader with time to search. Nobody reads a 40-page handbook at a checkpoint.

---

## Design Principles

These constrain every requirement below. They are the spine of the product; a feature that violates one gets cut.

**1. De-escalation over confrontation.** The naive version of this product gets people hurt. An agent that says *"He can't do that, refuse!"* can turn a ₹1,000 challan into an obstruction charge or a beating. Every response leads with the safest available action, and asserting a right is framed as a calm, specific, quotable sentence — never as defiance. **The product's job is to lower the temperature while protecting the user's legal position.**

**2. The phone is not safe.** Phones get taken, switched off, and handed over. Any evidence that lives only on the device is evidence that can disappear. Capture streams off-device within seconds or it does not count.

**3. Silence beats a wrong answer.** A confidently hallucinated section number is the single most dangerous output this system can produce, because the user will repeat it out loud to an officer. When confidence is low, the agent gives the verified generic guidance ("You may ask for the officer's name and buckle number, and you may ask to see the challan book") and explicitly says it cannot confirm the specific provision.

**4. Speed is a correctness property.** An accurate answer delivered in 40 seconds is a failed answer. The latency budget is a hard requirement, not a performance goal.

**5. Rights information, not legal advice.** The product tells users what the law says and what they may do. It does not tell them what they should do in their specific case, does not predict outcomes, and hands off to a human lawyer at the earliest sensible point.

---

## Goals

1. **Deliver a usable, accurate answer within 8 seconds (p95)** of the user triggering panic mode, measured from tap to first spoken word.
2. **Preserve evidence that survives phone seizure** — ≥95% of panic sessions produce at least one durable, timestamped, off-device artifact (audio, location, or both).
3. **Reduce successful overcharging** — in the top 10 covered scenarios, users who used the agent report paying the statutory amount (or receiving a formal challan) at a materially higher rate than they did before.
4. **Produce a lawyer-usable handoff** — ≥80% of completed incidents generate a summary packet that a partnering advocate rates as "sufficient to act on without a follow-up call."
5. **Zero verified incidents of the agent's guidance escalating a situation.** Tracked as a safety metric with mandatory review of every reported case.

---

## Non-Goals

1. **State-specific law.** v1 covers central acts only — Motor Vehicles Act, BNSS, BNS, Constitution. State police acts, state traffic compounding schedules, and local prohibitory-order practice are out of scope. *Rationale: state coverage is a content-maintenance problem that would consume the entire build, and getting a state rule subtly wrong is worse than declining to answer.*
2. **Representing the user or contacting police.** The agent never speaks to an officer, never places a call to a station, never files anything on the user's behalf. *Rationale: liability, and it would make the user a passenger in their own encounter.*
3. **Predicting legal outcomes.** No "you'll probably win this." *Rationale: unfalsifiable, unethical, and outside the product's competence.*
4. **A general legal chatbot.** Property disputes, divorce, contracts, employment — all out. *Rationale: the entire product thesis is the 90-second window. Broadening dilutes the content quality bar and the interface.*
5. **Live human lawyer connection in v1.** The packet is asynchronous. *Rationale: a lawyer-on-call network is an operations business, not a feature; it can be layered on once the packet format is proven.*

---

## User Stories

### Primary: person in the encounter

- As a rider stopped by traffic police, I want to know the actual statutory penalty for what I'm accused of, so I can tell whether the amount being demanded is legitimate.
- As a rider whose keys have been taken, I want the specific sentence to say out loud, so I can object without sounding aggressive.
- As someone being asked to "come to the station," I want to know immediately whether this is an arrest and what must legally happen next, so I don't consent to something I could have declined.
- As a woman being stopped or searched, I want to know the protections that specifically apply to me, so I can invoke them before the search begins.
- As a student at a peaceful protest, I want to know what a dispersal order actually authorises, so I know the difference between lawful dispersal and unlawful force.
- As someone whose phone may be taken, I want everything I record to be safe off my device within seconds, so seizing my phone doesn't destroy the evidence.
- As someone frightened and alone, I want my sister to know where I am with one tap, so somebody is coming.

### Secondary: bystander

- As a bystander watching someone get detained, I want to know what I'm allowed to film and from what distance, so I can document it without being charged with obstruction.

### Tertiary: lawyer

- As an advocate receiving a case, I want a structured incident packet with a timeline, the officer details captured, the media files, and the provisions the user was told about, so I can assess it in five minutes instead of an hour-long intake call.

### Edge and failure cases

- As a user in a low-signal area, I want the top scenarios to work with no connectivity, so the product doesn't fail exactly where policing is heaviest.
- As a user whose situation isn't covered, I want the agent to say so plainly and give me the universal safe actions, rather than improvise something that sounds authoritative.

---

## Requirements

### P0 — Must have

#### R1. Panic mode: one-tap voice entry
Lock-screen widget and home-screen shortcut. Single tap starts a session — no login, no menu, no scenario picker.

**Acceptance criteria**
- Given the phone is locked, when the user taps the widget, then a session starts and recording begins within 2 seconds without unlocking.
- Given a session has started, when the user describes the situation aloud, then the agent classifies it into a covered scenario or the "uncovered" fallback within 6 seconds.
- Given the user cannot speak, when they open the app, then the 10 covered scenarios are reachable as large tap targets on the first screen.
- The agent's first spoken words begin within **8 seconds (p95), 12 seconds (p99)** of the initial tap.
- No output ever tells the user to physically resist, flee, or refuse a lawful instruction.

#### R2. Scenario coverage — the v1 ten
Verified content for exactly these, under central law:

| # | Scenario | Core provisions |
|---|---|---|
| 1 | Traffic stop — no helmet | MV Act s.129, s.194D |
| 2 | Traffic stop — documents not carried | MV Act s.130, s.158 |
| 3 | Officer demands cash / inflated amount | MV Act s.200 compounding; who is authorised |
| 4 | Officer takes keys or blocks the vehicle | No enabling provision; MV Act s.207 detention limits |
| 5 | "Come to the station" — detention vs. arrest | BNSS s.35, s.35(3) notice rule |
| 6 | Arrest happening now | BNSS s.47 grounds, s.48 inform relative, s.58 24-hour production; Art. 22 |
| 7 | Search or frisking (with a specific branch for women) | BNSS search provisions; female-officer requirement |
| 8 | Phone — demand to hand over or unlock | Art. 20(3); seizure procedure |
| 9 | Peaceful protest — dispersal order | BNSS s.163; Art. 19(1)(a),(b); proportionality of force |
| 10 | Force used on peaceful protesters | Constitutional limits; what to document |

**Acceptance criteria**
- Every scenario returns: (a) what the officer *can* lawfully do, (b) what they *cannot*, (c) the exact sentence to say, (d) the single most important thing to document right now.
- Each answer is ≤60 spoken words before the user can interrupt for more.
- Scenario 4 correctly distinguishes "no legal basis to take keys" from "lawful detention of the vehicle under s.207 where the rider has no licence at all" — it does not collapse the two.

#### R3. The quotable line
For each scenario, one short, calm, legally grounded sentence, displayed in large text and spoken slowly enough to repeat.

**Acceptance criteria**
- Every line is under 25 words and contains no insult, challenge, or imperative directed at the officer.
- Every line is reviewed by counsel specifically for escalation risk, not just legal accuracy.
- The screen simultaneously shows a short "do not say" list for that scenario.
- Available in Hindi and English at launch; the line is shown in both, since the user may need to speak one and understand the other.

#### R4. Evidence capture that survives seizure
Continuous audio + periodic location from session start, chunked and uploaded every 10 seconds.

**Acceptance criteria**
- Given a session is active, when 10 seconds of audio exist, then that chunk is uploaded and acknowledged before the next begins.
- Given the phone is switched off mid-session, when the session is later reviewed, then all acknowledged chunks are present and playable.
- Given there is no connectivity, when the session runs, then chunks queue encrypted on device and upload automatically on reconnection, with the user told plainly that evidence is not yet safe.
- All artifacts carry a server-side timestamp and a content hash recorded at receipt.
- Recording is visually and audibly indicated — no covert capture.
- The user can permanently delete a session's evidence, and deletion is honoured within 24 hours.

#### R5. Trusted contact alert
One tap sends live location, a one-line situation summary, and a link to the session to pre-configured contacts.

**Acceptance criteria**
- Delivery via at least two independent channels (SMS + data) to survive network conditions.
- Contacts are configured during onboarding, before the product is ever needed.
- The recipient sees a plain-language message that assumes zero context and no app install.

#### R6. Accuracy governance
The content pipeline is a P0 feature, not a process detail.

**Acceptance criteria**
- Every legal claim in the corpus maps to a primary source — bare act text, gazette notification, or reported judgment. **No blog, news article, or SEO page is an acceptable citation.**
- Every scenario is signed off by a named advocate before it ships, with the sign-off date stored and displayed.
- The agent answers **only** from the verified corpus. It does not generate legal claims from model knowledge at runtime.
- Given a user query that does not map to a covered scenario with high confidence, when the agent responds, then it says it cannot confirm the specifics and gives only the universal safe actions.
- The corpus is versioned; every answer records which version produced it, so a later correction can identify who received bad guidance.
- A monthly review checks for amendments; provisions unreviewed for 6 months are flagged in-product.

#### R7. Standing disclaimer and scope honesty
Shown at onboarding and on every answer screen in compressed form: this is rights information under central law, not legal advice; state rules may differ; verify before relying on it in court.

---

### P1 — Nice to have

- **R8. Incident packet for lawyers.** Auto-generated PDF + media bundle: chronological timeline, location trail, officer details captured, provisions surfaced during the session, verbatim transcript, and a plain-language summary. *(Strong candidate for promotion to P0 — see Open Questions. The user has named this as the product's second half.)*
- **R9. Escalation guidance.** After the incident: which authority hears this complaint, the deadline, the required contents, and a draft complaint the user edits.
- **R10. Offline scenario cards.** The 10 scenarios cached as static cards, functional with no signal and no model call.
- **R11. Officer detail capture.** Guided prompts to record name, buckle number, station, and vehicle number while it is still visible.
- **R12. Language expansion.** Tamil, Telugu, Bengali, Marathi, Kannada.
- **R13. Post-incident debrief.** Structured questions within 24 hours while memory is fresh, appended to the packet.

### P2 — Future considerations

Architect for these; do not build them now.

- **State law layer.** The content model must key every provision to a jurisdiction from day one, even when that value is always `IN-CENTRAL` in v1. Retrofitting this is painful.
- **Lawyer network / live connection.** The packet format should be designed as the handoff interface it would need to be.
- **Aggregate pattern reporting.** With explicit consent, anonymised data on where and how overcharging clusters — potentially the most socially valuable output the product has. Requires a consent and anonymisation design that must not be bolted on later.
- **Wearable / voice-assistant trigger** for situations where reaching for a phone is itself risky.

---

## Success Metrics

### Leading (days to weeks)

| Metric | Target | Method |
|---|---|---|
| Time to first spoken word | p95 ≤ 8s | Client instrumentation, tap to audio start |
| Sessions with ≥1 durable off-device artifact | ≥95% | Server-side receipt logs |
| Queries resolved by verified corpus (vs. fallback) | ≥85% | Classifier confidence logging |
| Trusted-contact alert delivery | ≥98% on ≥1 channel | Delivery receipts |
| Post-session "did this match what happened?" | ≥80% yes | In-app, 1 tap, 24h later |

### Lagging (weeks to months)

| Metric | Target | Method |
|---|---|---|
| Incidents producing a lawyer-actionable packet | ≥80% | Advocate rating, partner sample |
| Users reporting they paid the statutory amount / got a formal challan | Directional improvement vs. baseline survey | Follow-up survey |
| Verified escalation incidents attributable to guidance | **0** | Mandatory review of every report |
| Corpus provisions overdue for review | 0 | Content dashboard |

### Explicit anti-metrics

**Do not optimise for DAU, session length, or engagement.** Success looks like a product people open rarely, use for ninety seconds, and never think about again. Growth in usage is a signal about policing, not about product quality. Treating it as a win metric will corrupt every design decision downstream.

---

## Open Questions

**Blocking — must resolve before build**

- **[Legal / Founder]** What is the liability posture if a user is charged with obstruction after repeating a line the agent gave them? This determines whether R3 ships at all in its current form.
- **[Legal]** Is there any state where continuous audio recording of a public official in a public place carries a genuine legal risk? This gates R4's default-on behaviour.
- **[Legal]** Who signs off the corpus, and on what retainer? R6 is unbuildable without a named advocate committed before development starts.
- **[Product]** Is R8 (the lawyer packet) P0 rather than P1? The stated product thesis is "help in the moment, then hand to a lawyer" — if the handoff is the point, the current priority split is wrong.

**Non-blocking — resolve during build**

- **[Engineering]** Latency budget allocation across speech recognition, classification, retrieval, and speech synthesis. On-device classification for the 10 scenarios is likely necessary to hit 8s on a mid-range Android on a weak network.
- **[Engineering]** Where does evidence live, under whose jurisdiction, and who can be compelled to produce it? A subpoena to the evidence host is a foreseeable attack on the product's core promise.
- **[Design]** How does the interface behave when the phone is snatched mid-session — auto-lock, continue recording, or both?
- **[Data]** What is the pre-launch baseline for the overcharging metric, and how is it gathered honestly?
- **[Product]** "Kavach" is a placeholder. The name matters more than usual: it will be visible on a screen an officer may be looking at, and a confrontational name is a design flaw.

---

## Timeline Considerations

No external hard deadline. Suggested phasing:

**Phase 0 — Content spine (3 weeks).** Advocate engaged, 10 scenarios researched from primary sources, drafted, reviewed, and signed off. Content model and versioning schema built. **No app work.** This phase de-risks everything after it, and starting the app first is the most likely way this project ships something dangerous.

**Phase 1 — In the moment (5 weeks).** R1–R5, R7. Ship to a closed group. This is the minimum that solves the stated problem.

**Phase 2 — The handoff (4 weeks).** R8, R9, R11 — assuming R8 is not promoted to P0 and pulled into Phase 1.

**Phase 3 — Reach.** R10, R12, then the state-law layer.

**Dependencies**

- Phase 0 gates everything. No advocate, no product.
- Legal answers on the two blocking liability questions gate Phase 1's scope.
- Partnering with a legal-aid organisation should begin in Phase 0 — the packet format in Phase 2 needs a real consumer, and they are also the most credible distribution channel.

---

*All statutory references are illustrative and pending verification by qualified counsel. This document is a product specification, not legal advice.*
