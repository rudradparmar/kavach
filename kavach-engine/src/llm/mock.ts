import type { LlmProvider, ExtractionInput, ExtractionResult, ExtractedFact } from "./provider.js";
import type { FactKey, Tri } from "../types.js";

/**
 * Deterministic, offline, zero-latency provider.
 *
 * It exists for two reasons: the replay harness must run with no API key, and
 * PRD R10/latency work will need an on-device path that cannot call a model at
 * all. This is the honest baseline that path has to beat.
 *
 * Two rules govern the cue table below.
 *
 * **Polarity first.** Within a fact, the first matching rule wins (see `seen`
 * in extract), so a specific negative must be listed before the broad
 * affirmative that would otherwise swallow it. "I am not under arrest"
 * matching /under arrest/ and recording arrestAsserted=yes is exactly the
 * failure this ordering prevents. A fact established *backwards* is worse than
 * one never established: the tri-state design in engine/rules.ts stops a flag
 * firing on an unestablished fact, but nothing downstream can catch an
 * inverted one — the rule engine trusts what it is given.
 *
 * **Both scripts, spelled out.** Hindi cues are written in Devanagari beside
 * their romanised forms, including nukta variants (गिरफ़्तार / गिरफ्तार) as
 * separate alternates. Normalising nukta away at match time would be tidier
 * but changes string length, which would misalign the `snippet()` index and
 * corrupt the verbatim evidence quote attached to every fact. Duplicated
 * alternates are the cheaper mistake.
 *
 * **Shield before asserting.** A cue whose value is `unknown` matches a
 * question or a request and claims the fact for that turn without reporting
 * anything. It sits above the rules that would otherwise read "why am I being
 * arrested?" as `groundsGiven=no`.
 *
 * This is a keyword matcher, not a parser. Negation is handled with a bounded
 * gap, which covers the plain cases and will lose a compound sentence. That
 * limitation is the reason a real provider exists.
 */

interface Cue { re: RegExp; fact: FactKey; value: Tri | number | null }

const CUES: Cue[] = [
  // --- helmet ---------------------------------------------------------
  // "I am not wearing a helmet" contains "wearing a helmet": negative first.
  [/(\bnot|n'?t|\bnever)\b[^.?!]{0,12}\b(wearing|wear|wore|have|had|got)\b[^.?!]{0,4}\bhelmet\b|\bno helmet\b|\bwithout (a )?helmet\b|helmet nahi|हेलमेट नहीं|बिना हेलमेट/i, "helmetWorn", "no"],
  [/wearing (a )?helmet|helmet (hai|pehna)|हेलमेट (पहना|लगा|है)/i, "helmetWorn", "yes"],
  [/\bhelmet\b|headgear|हेलमेट/i, "helmetWorn", "no"],

  // --- the stop -------------------------------------------------------
  [/\bstopped\b|pulled over|pull over|stop the (bike|car|vehicle|scooter|scooty)|roka|gaadi roko|checking|रोका|रोक लिया|गाड़ी रोको|चेकिंग|चेक कर/i, "vehicleStopped", "yes"],

  // --- licence: carried is a different fact from held ------------------
  [/licence at home|license at home|licence nahi laya|forgot my licence|didn'?t bring my licence|left it at home|लाइसेंस (घर|नहीं लाया)|घर पर (ही )?(रह|छूट)/i, "licenceCarried", "no"],
  // "लाइसेंस नहीं है" (I hold none) must not be confused with
  // "लाइसेंस नहीं लाया" (I hold one, it is at home) — hence the exact forms.
  [/no licence at all|never had a licence|don'?t have a licence|कोई लाइसेंस नहीं|लाइसेंस बना ही नहीं|लाइसेंस नहीं है/i, "licenceHeld", "no"],
  [/i have a (valid )?licen[cs]e|licence hai|mera licence|मेरा लाइसेंस|वैध लाइसेंस|लाइसेंस है/i, "licenceHeld", "yes"],

  // --- vehicle --------------------------------------------------------
  [/\bkeys?\b|chaabi|chabi|चाबी|चाभी/i, "keysTaken", "yes"],
  [/(not|won'?t) let (you|me) go|blocking|gaadi nahi|जाने नहीं दे|गाड़ी रोक|रास्ता रोक/i, "vehicleBlocked", "yes"],

  // --- money ----------------------------------------------------------
  [/cash|paise|settle|adjust|chai pani|note de|(rupees?|rs\.?) (do|de do|dedo|nikalo)\b|पैसे|पैसा|नकद|चाय पानी|रिश्वत|घूस|सेटल|(रुपये|रुपए) (दो|दे दो|निकालो)/i, "cashDemanded", "yes"],
  [/\bno\b[^.?!]{0,20}\b(challan|receipt)\b|challan nahi|without (a )?receipt|चालान नहीं|रसीद नहीं|बिना रसीद/i, "formalChallanOffered", "no"],
  [/challan (book|bana|de)|receipt|written challan|चालान (बुक|बना|दे)|रसीद/i, "formalChallanOffered", "yes"],

  // --- detention and arrest -------------------------------------------
  [/station chalo|thane chalo|come (with us|to the station)|थाने चलो|थाने आ|स्टेशन चलो|साथ चलो|चौकी चलो/i, "askedToComeToStation", "yes"],
  [/\b(not|never)\b[^.?!]{0,30}\b(under arrest|being arrested)\b|arrest nahi|giraftar nahi|giraftar nahin|nahi giraftar|गिरफ़्तार नहीं|गिरफ्तार नहीं|अरेस्ट नहीं/i, "arrestAsserted", "no"],
  [/under arrest|\b(you are|you're|he is|she is|i am|i'm|we are) being arrested\b|\b(i|we) (have|'ve) been arrested\b|\barresting you\b|giraftar|arrest kar|गिरफ़्तार|गिरफ्तार|अरेस्ट कर|हथकड़ी/i, "arrestAsserted", "yes"],
  // groundsGiven and relativeInformed. A *request* ("why am I being arrested?",
  // "let me call my family") says nothing about whether the thing has
  // happened, so it is shielded to `unknown` (see SHIELD below) rather than
  // read as `no`. Order matters three ways: an explicit `no` beats a question
  // in the same window; "I haven't told my family" (the user's own inaction,
  // not the police's) is shielded *before* the `no` rule could read it; and
  // every shield sits above the `yes` rule. Reading it as `no` fired arrest-without-grounds and
  // arrest-relative-not-informed — UNLAWFUL flags — off a question, and on
  // "I informed my family" it inverted outright. Only an explicit statement
  // that it has not happened, or is being prevented, records `no`.
  [/\b(no|not|never|without|didn'?t|did not|won'?t|will not|refus\w*)\b[^.?!]{0,25}\b(grounds|reason)\b[^.?!]{0,25}\b(arrest\w*|giraftar\w*)|\b(arrest\w*|giraftar\w*)\b[^.?!]{0,30}\b(without|for no)\b[^.?!]{0,15}\b(reason|grounds)\b|\b(won'?t|will not|didn'?t|did not|not|refus\w*)\b[^.?!]{0,10}\b(tell|told|telling|say|said|saying|give|gave|giving)\b[^.?!]{0,8}\b(why|the grounds|the reason|any reason|grounds)\b|(kaaran|karan|wajah|vajah) nahi bata|(कारण|वजह|आधार) (भी )?नहीं बता/i, "groundsGiven", "no"],
  [/\bwhy am i being arrested\b|\bwhat (are|is) the (grounds|reason)\b|\bon what (grounds|basis)\b|\b(tell|give) me the (grounds|reason)\b|kyun giraftar|kis (aadhar|aadhaar|adhar) par|किस आधार पर|क्यों गिरफ़्तार|क्यों गिरफ्तार/i, "groundsGiven", "unknown"],
  [/\bgrounds (of|for) (the |my )?arrest (are|is|were|was)\b|\b(you are|you're|i am|i'?m) (being )?arrested (for|under|because)\b|\barrest(ed|ing) (you |me )?(for|under section|because)\b|के (कारण|आरोप में) (गिरफ़्तार|गिरफ्तार)|गिरफ़्तारी का (कारण|आधार) (है|यह)|गिरफ्तारी का (कारण|आधार) (है|यह)/i, "groundsGiven", "yes"],
  [/\bno\b[^.?!]{0,20}\bnotice\b|notice nahi|कोई नोटिस नहीं|नोटिस नहीं/i, "noticeUnderS35Given", "no"],
  [/\bnotice\b|written notice|35\(3\)|नोटिस/i, "noticeUnderS35Given", "yes"],
  [/\bi (have not|haven'?t|did not|didn'?t|could not|couldn'?t|have yet to)\b[^.?!]{0,10}\b(inform|tell|told|call|phone)/i, "relativeInformed", "unknown"],
  [/\b(won'?t|will not|didn'?t|did not|not|never|refus\w*)\b[^.?!]{0,8}\b(let|letting|allow|allowing|allowed)\b[^.?!]{0,6}\b(me )?(to )?(call|inform|tell|phone|contact)\b|\b(no ?one|nobody)\b[^.?!]{0,15}\b(informed|told|called|contacted)\b|\b(not|n'?t|never)\b[^.?!]{0,15}\b(informed|told|called|contacted)\b[^.?!]{0,10}\bmy (family|father|mother|sister|brother|wife|husband|parents)|\bmy (family|father|mother|sister|brother|wife|husband|parents) (doesn'?t|does not|don'?t|do not) know\b|(bataane|batane|phone karne) nahi (de|diya|dete|de rahe)|ghar (par |walon ko )?(kisi ne )?nahi bataya|(बताने|फ़ोन करने|फोन करने) नहीं (दे|दिया|देते|दे रहे)|घर (पर |वालों को )?(किसी ने )?नहीं बताया|परिवार को (किसी ने )?नहीं बताया/i, "relativeInformed", "no"],
  [/\b(let me|can i|may i|could i|i want to|i need to|i'?d like to|allow me to|i must|i should)\b[^.?!]{0,20}\b(inform|tell|call|phone|ring)\b|ghar (par |walon ko |wale ko )?bata(na|ne do|ne dijiye|un|oon|du|doon)\b|phone karne do|घर (पर |वालों को )?बता(ना|ने दो|ने दीजिए|ऊं|ऊँ|दूं|दूँ)|परिवार को बता(ना|ने दो|ने दीजिए|ऊं|ऊँ|दूं|दूँ)|(फ़ोन|फोन) करने (दो|दीजिए)/i, "relativeInformed", "unknown"],
  [/\b(informed|told|called|phoned|contacted)\b[^.?!]{0,10}\bmy (family|father|mother|sister|brother|wife|husband|parents)\b|\bmy (family|father|mother|sister|brother|wife|husband|parents) (has been|have been|was|were|is|are) (informed|told|called|contacted)\b|\bmy (family|father|mother|sister|brother|wife|husband|parents) knows?\b|ghar (par |walon ko )?bata (diya|di)|घर (पर |वालों को )?बता (दिया|दी)|परिवार को (बता दिया|सूचना दे दी|सूचित कर दिया)/i, "relativeInformed", "yes"],

  // --- search ---------------------------------------------------------
  [/talashi|search|frisk|pockets|bag khol|तलाशी|जामा तलाशी|जेब|बैग खोल/i, "searchRequested", "yes"],
  [/searching me now|hands up|starting the search|talashi le rahe|तलाशी ले रहे|तलाशी शुरू|हाथ ऊपर/i, "searchBegun", "yes"],
  [/\bno\b[^.?!]{0,24}(female officer|lady (constable|officer)|mahila)|koi mahila nahi|कोई महिला (पुलिस |अधिकारी )?नहीं|महिला (पुलिस|अधिकारी) नहीं/i, "femaleOfficerPresent", "no"],
  [/female officer|mahila|lady (constable|officer)|महिला (पुलिस|अधिकारी|कांस्टेबल)/i, "femaleOfficerPresent", "yes"],

  // --- phone ----------------------------------------------------------
  [/give me your phone|phone do|hand over your phone|phone de|फ़ोन दो|फोन दो|मोबाइल दो|फ़ोन दे|फोन दे/i, "phoneDemanded", "yes"],
  [/unlock|password|passcode|pin bata|अनलॉक|पासवर्ड|पिन बता|खोल कर दिखा/i, "unlockDemanded", "yes"],
  [/seizure memo|zabti|list of items|ज़ब्ती|जब्ती|सीज़र मेमो|सामान की सूची/i, "seizureMemoOffered", "yes"],

  // --- protest --------------------------------------------------------
  [/disperse|hato|clear the area|dharna khatam|हटो|हट जाओ|तितर बितर|धरना खत्म|जगह खाली/i, "dispersalOrderGiven", "yes"],
  [/section 163|prohibitory order|order (number|hai)|धारा 163|धारा १६३|निषेधाज्ञा|आदेश (है|संख्या)/i, "orderUnderS163Cited", "yes"],
  // A false "peaceful" would fire force-on-peaceful-assembly, an UNLAWFUL
  // flag, off a crowd that was not peaceful. The negative goes first.
  // ...and "nobody was violent" contains "violent": a negated negative is a
  // positive, so it goes above both (found by the eval holdout set).
  [/\b(nobody|no ?one|none of us|not|never|wasn'?t|weren'?t)\b[^.?!]{0,20}\b(violent|violence)\b|हिंसा नहीं|कोई हिंसा नहीं/i, "assemblyPeaceful", "yes"],
  [/\bnot\b[^.?!]{0,20}peaceful|violent|pathrav|पथराव|पत्थर|हिंसा|शांतिपूर्ण नहीं/i, "assemblyPeaceful", "no"],
  [/peaceful|shanti|not doing anything|sitting quietly|शांतिपूर्ण|शांति से|कुछ नहीं कर रहे|चुपचाप बैठे/i, "assemblyPeaceful", "yes"],
  [/lathi|beating|hitting|maar rahe|water cannon|tear ?gas|charge|लाठी|लाठीचार्ज|मार रहे|पीट|आंसू गैस|पानी की बौछार/i, "forceUsed", "yes"],

  // --- who the user is ------------------------------------------------
  [/i am a woman|main mahila|i'?m female|मैं महिला|मैं औरत|मैं लड़की/i, "userIsFemale", "yes"],
].map(([re, fact, value]) => ({ re: re as RegExp, fact: fact as FactKey, value: value as Tri }));

/** Latin and Devanagari digits, and both spellings of "rupees". */
const AMOUNT =
  /(?:rs\.?|₹|rupees?|रुपये|रुपए|रु\.?)\s?([0-9०-९][0-9०-९,]{1,6})|([0-9०-९][0-9०-९,]{2,6})\s?(?:rupees?|rs\.?|रुपये|रुपए)/i;

const DEVANAGARI_DIGITS = "०१२३४५६७८९";
const toLatinDigits = (s: string) =>
  s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));

export class MockProvider implements LlmProvider {
  readonly name = "mock";

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const text = input.turns.map((t) => t.text).join(" \n ");
    const recent = input.turns.slice(-3).map((t) => t.text).join(" \n ");

    const facts: ExtractedFact[] = [];
    const seen = new Set<FactKey>();
    for (const c of CUES) {
      if (!input.allowedFactKeys.includes(c.fact)) continue;
      const m = c.re.exec(recent);
      if (!m) continue;
      if (seen.has(c.fact)) continue;
      seen.add(c.fact);
      // SHIELD: an `unknown` cue claims the fact for this turn without
      // reporting it, so the broader rules after it cannot misread a
      // question or a request as a statement.
      if (c.value === "unknown") continue;
      facts.push({ fact: c.fact, value: c.value, evidence: snippet(recent, m.index) });
    }
    const am = AMOUNT.exec(recent);
    if (am) {
      const raw = toLatinDigits(am[1] ?? am[2] ?? "").replace(/,/g, "");
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        facts.push({ fact: "amountDemanded", value: n, evidence: snippet(recent, am.index) });
      }
    }

    // Scenario scoring. Recency dominates deliberately: an encounter that has
    // moved from a document check to a key seizure must reclassify on the turn
    // that says "chaabi", not three turns later when the older cues age out.
    const last = input.turns.at(-1)?.text ?? "";
    const prev = input.turns.at(-2)?.text ?? "";
    let best: string | null = null;
    let bestScore = 0;
    for (const id of input.allowedScenarioIds) {
      let score = 0;
      for (const cue of input.cues[id] ?? []) {
        const re = new RegExp(escape(cue), "i");
        if (re.test(last)) score += 3;
        else if (re.test(prev)) score += 1;
        else if (re.test(text)) score += 0.5;
      }
      if (score > bestScore) { bestScore = score; best = id; }
    }
    // Deliberately conservative: one weak cue is not a classification.
    const confidence = bestScore === 0 ? 0 : Math.min(0.95, 0.3 + bestScore * 0.12);
    return { scenarioId: confidence >= 0.5 ? best : null, confidence, facts };
  }

  async narrate(input: { factSummary: string; flagSummary: string }): Promise<string> {
    return [
      "Automated summary (mock provider — no model was called).",
      "",
      "Facts recorded during the session:",
      input.factSummary || "  none",
      "",
      "Concerns flagged by the rule engine:",
      input.flagSummary || "  none",
    ].join("\n");
  }
}

const snippet = (s: string, at: number) => s.slice(Math.max(0, at - 40), at + 60).replace(/\s+/g, " ").trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
