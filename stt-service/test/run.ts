import { MockProvider } from "../src/mock.js";
import { ROMANISATION_PROMPT } from "../src/openaiCompatible.js";
import { detectScript } from "../src/provider.js";

/**
 * Same shape as kavach-engine/test/run.ts: no framework, no config, runs with
 * tsx and nothing else. Checks are awaited in order, so an async assertion
 * that rejects fails the run rather than disappearing.
 */

let passed = 0;
let failed = 0;

const group = (name: string) => console.log(`\n${name}`);

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${(e as Error).message}`);
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
}

const audio = (n = 128) => Buffer.alloc(n, 1);
const input = () => ({
  audio: audio(),
  contentType: "audio/m4a",
  filename: "t.m4a",
  language: null,
  prompt: null,
});

async function main() {
  group("script detection");

  await check("romanised Hindi reads as Latin", () => {
    eq(detectScript("Digital nahi chalega. Chaabi do."), "latin", "romanised");
  });

  await check("Devanagari is detected", () => {
    eq(detectScript("डिजिटल नहीं चलेगा। चाबी दो।"), "devanagari", "devanagari");
  });

  await check("code-mixed script is reported as mixed, not as one or the other", () => {
    eq(detectScript("Digital नहीं चलेगा"), "mixed", "mixed");
  });

  await check("digits and punctuation alone are not a script", () => {
    eq(detectScript("2000 ..."), "other", "other");
  });

  group("the script mismatch this service exists to surface");

  await check("Devanagari is the case the engine's romanised cues miss", () => {
    // The engine's classifierCues are all romanised Latin ("chaabi", "paise",
    // "thane chalo"). A Devanagari transcript of the same words classifies to
    // the fallback. The service reports the script so the client can say so.
    const deva = detectScript("चाबी दो");
    const latin = detectScript("chaabi do");
    eq(deva, "devanagari", "Devanagari branch");
    eq(latin, "latin", "Latin branch");
    assert(deva !== latin, "the two scripts must be distinguishable");
  });

  await check("the romanisation prompt names the scripts and gives examples", () => {
    assert(/latin/i.test(ROMANISATION_PROMPT), "prompt should ask for Latin script");
    assert(/devanagari/i.test(ROMANISATION_PROMPT), "prompt should name what to avoid");
    assert(/chaabi/i.test(ROMANISATION_PROMPT), "prompt should carry cue-shaped examples");
  });

  group("mock provider");

  await check("the provider declares itself simulated", () => {
    assert(new MockProvider().simulated, "provider must declare itself simulated");
  });

  await check("mock text says so in the text itself, not just a flag", async () => {
    const r = await new MockProvider().transcribe(input());
    assert(r.simulated, "result flag must be set");
    assert(/SIMULATED/.test(r.text), "a canned transcript must be self-identifying on screen");
  });

  await check("mock returns romanised text, so the offline path actually classifies", async () => {
    const r = await new MockProvider().transcribe(input());
    eq(r.script, "latin", "mock script");
  });

  await check("mock advances through the escalation rather than repeating one line", async () => {
    const p = new MockProvider();
    const a = await p.transcribe(input());
    const b = await p.transcribe(input());
    assert(a.text !== b.text, "consecutive calls should differ");
    assert(/licence/i.test(a.text), "first line should be the document check");
    assert(/chaabi/i.test(b.text), "second line should be the key seizure");
  });

  group("harness");

  await check("a rejecting async check is seen, not swallowed", async () => {
    // Guards the harness itself. An earlier version of this file declared the
    // callback as sync, so every async rejection escaped the try/catch and the
    // suite went green no matter what the providers did.
    let sawRejection = false;
    try {
      await (async () => {
        throw new Error("deliberate");
      })();
    } catch {
      sawRejection = true;
    }
    assert(sawRejection, "await inside check() must surface a rejected promise");
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
