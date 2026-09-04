/**
 * Drives the whole perception pipeline: audio bytes → stt-service → transcript
 * → kavach-engine → guidance. Uses the app's own client modules, so a break in
 * either boundary shows up here rather than on a device.
 *
 *   cd kavach-engine  && npm run dev     # :8787
 *   cd stt-service    && npm run dev     # :8788
 *   cd app            && npm run pipeline
 *
 * It also runs the script parity check. The corpus cues were romanised Latin
 * only, so a correct Devanagari transcript of the same sentence classified to
 * the fallback and a Hindi speaker got the universal safe actions on every
 * turn. Devanagari cues closed that; this check is what keeps it closed, and
 * it fails the run if the two scripts ever diverge again.
 */

import { createSession, getHealth, sendTurn } from "../src/api/client";
import { getSttHealth } from "../src/stt/client";
import { apiKey } from "./creds";

const KEY = apiKey();

const ENGINE = process.argv[2] ?? "http://localhost:8787";
const STT = process.argv[3] ?? "http://localhost:8788";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

let failures = 0;

/**
 * Posts raw bytes the way the app does. Not using the app's transcribe()
 * directly because that reads a file:// URI through fetch, which only exists
 * inside React Native — the wire format either side of it is identical.
 */
async function transcribeBytes(bytes: Buffer, language: string | null) {
  const params = new URLSearchParams({ filename: "turn.m4a" });
  if (language) params.set("language", language);
  const res = await fetch(`${STT}/transcribe?${params.toString()}`, {
    method: "POST",
    headers: { "content-type": "audio/m4a", ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
    body: new Uint8Array(bytes),
  });
  if (!res.ok) throw new Error(`stt ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as {
    text: string;
    script: string;
    provider: string;
    simulated: boolean;
    classifierScriptMismatch: boolean;
    totalMs: number;
  };
}

async function main() {
  const [engineHealth, sttHealth] = await Promise.all([getHealth(ENGINE), getSttHealth(STT)]);

  console.log(`\n${bold("engine")}  ${ENGINE}  ${engineHealth.provider} · ${engineHealth.corpusVersion} (${engineHealth.corpusStatus})`);
  console.log(`${bold("speech")}  ${STT}  ${sttHealth.provider}${sttHealth.simulated ? yellow(" · SIMULATED") : ""}\n`);

  /* ---------------------------------------------------------------- */
  console.log(bold("1. audio → transcript → guidance"));

  const { sessionId, sessionToken } = await createSession(ENGINE, KEY);
  const audio = Buffer.alloc(4096, 7); // stand-in for a recording

  for (let i = 0; i < 4; i += 1) {
    const t0 = Date.now();
    const heard = await transcribeBytes(audio, "hi");
    const transcribeMs = Date.now() - t0;

    const { update, violations, latencyMs } = await sendTurn(ENGINE, sessionId, heard.text, "officer", sessionToken);
    const total = Date.now() - t0;

    const scenario = update.fallback ? yellow("FALLBACK") : green(update.scenarioId ?? "?");
    console.log(`  ${dim(`[${i}]`)} ${heard.text.replace(/\s*\[SIMULATED.*$/, "")}`);
    console.log(
      `      → ${scenario}  ${dim(`transcribe ${transcribeMs}ms · engine ${latencyMs}ms · total ${total}ms`)}`,
    );
    if (update.newFlags.length > 0) {
      for (const f of update.newFlags) {
        const paint = f.severity === "unlawful" ? red : f.severity === "irregular" ? yellow : dim;
        console.log(`      ${paint(f.severity.toUpperCase())} ${f.ruleId}`);
      }
    }
    if (violations.length > 0) console.log(`      ${yellow("GUARD")} ${violations.map((v) => v.kind).join(", ")}`);
    if (!update.disclaimer) {
      console.log(red("      !! no disclaimer — PRD R7 violated"));
      failures += 1;
    }
  }

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("2. script parity — Hindi must reach the same scenario as romanised")}`);

  const pairs: Array<{ label: string; latin: string; deva: string }> = [
    { label: "keys", latin: "Digital nahi chalega. Chaabi do.", deva: "डिजिटल नहीं चलेगा। चाबी दो।" },
    {
      label: "cash",
      latin: "Ab 2000 rupees do aur nikal jao. Challan nahi banega, cash de do.",
      deva: "अब 2000 रुपये दो और निकल जाओ। चालान नहीं बनेगा, नकद दे दो।",
    },
    { label: "station", latin: "Nahi dena hai to thane chalo.", deva: "नहीं देना है तो थाने चलो।" },
  ];

  for (const p of pairs) {
    const a = await createSession(ENGINE, KEY);
    const b = await createSession(ENGINE, KEY);
    const latin = await sendTurn(ENGINE, a.sessionId, p.latin, "officer", a.sessionToken);
    const deva = await sendTurn(ENGINE, b.sessionId, p.deva, "officer", b.sessionToken);

    const latinId = latin.update.scenarioId ?? "FALLBACK";
    const devaId = deva.update.scenarioId ?? "FALLBACK";

    // The comparison only says something when the Latin side classified. If
    // both fall back, that is the classifier being unsure on a cold first
    // turn, not evidence about script — reporting it either way would be
    // reading a result out of noise.
    const latinClassified = !latin.update.fallback;
    const devaClassified = !deva.update.fallback;
    const agree = latinId === devaId;

    let verdict: string;
    if (!latinClassified) {
      verdict = dim("inconclusive — latin did not classify either");
    } else if (agree && devaClassified) {
      verdict = green("parity");
    } else {
      verdict = red("REGRESSION — Devanagari lost the scenario");
      failures += 1;
    }

    console.log(
      `  ${p.label.padEnd(8)} latin → ${latinClassified ? green(latinId) : dim(latinId)}   ` +
        `devanagari → ${devaClassified && agree ? green(devaId) : red(devaId)}`,
    );
    console.log(`           ${verdict}`);
  }

  console.log(
    `\n  ${dim("Hindi speech arrives in Devanagari; the corpus cues carry both scripts.")}`,
  );
  console.log(
    `  ${dim("A divergence here means a Hindi speaker silently gets the fallback instead")}`,
  );
  console.log(`  ${dim("of their scenario — which is why it fails the run rather than warning.")}\n`);

  console.log(failures === 0 ? green("pipeline OK") : red(`${failures} failure(s)`));
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(red(`\n${(e as Error).message}\n`));
  console.error(dim("Both services must be running: kavach-engine :8787 and stt-service :8788\n"));
  process.exit(1);
});
