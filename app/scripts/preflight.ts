/**
 * Is this deployment fit for a person who is not you to use?
 *
 *   npm run preflight -- https://api.your-domain.example
 *   npm run preflight                      # defaults to localhost:8787
 *
 * Everything else in `scripts/` answers "does the code work". This answers
 * "should this be in front of the public", which is a different question and
 * the one that gets skipped, because the code working feels like an answer.
 *
 * ## Two kinds of finding
 *
 * A **BLOCKER** means a person using this deployment could be harmed or could
 * lose their evidence. The script exits non-zero and the deployment is not
 * ready, whatever else is green.
 *
 * A **warning** means something is degraded in a way the product already
 * tells the user about. A mock speech provider is a warning, not a blocker,
 * because the app says SIMULATED in four places — the honesty is built in.
 *
 * ## Why it drives the app's own client
 *
 * It imports `src/api/*` and `src/evidence/*` — the same modules the phone
 * runs — rather than calling the services directly. The single most damaging
 * deployment bug in this project's history was not a service being down: it
 * was the client deriving sibling addresses with a hardcoded port, so every
 * TLS deployment was unreachable and every service reported itself healthy.
 * A preflight that curled three URLs would have passed that day.
 */

import { getHealth, createSession, sendTurn, deleteSession } from "../src/api/client";
import { siblingUrl } from "../src/api/url";
import { defaultEvidenceUrl, getEvidenceHealth } from "../src/evidence/client";
import { getSttHealth } from "../src/stt/client";
import { apiKey } from "./creds";

const BASE = (process.argv[2] ?? "http://localhost:8787").replace(/\/+$/, "");
const KEY = apiKey();

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

interface Finding {
  level: "blocker" | "warn" | "ok";
  what: string;
  detail: string;
}

const findings: Finding[] = [];
const blocker = (what: string, detail: string) => findings.push({ level: "blocker", what, detail });
const warn = (what: string, detail: string) => findings.push({ level: "warn", what, detail });
const ok = (what: string, detail: string) => findings.push({ level: "ok", what, detail });

async function main(): Promise<void> {
  console.log(`\n${bold("Kavach preflight")}  ${BASE}\n`);

  /* --- transport -------------------------------------------------- */

  if (BASE.startsWith("https://")) {
    ok("transport", "TLS");
  } else if (/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(BASE)) {
    warn("transport", "plain HTTP on loopback — fine for a check, not a deployment");
  } else {
    blocker(
      "transport",
      "plain HTTP over a network. Bearer tokens and the audio of a police encounter are " +
        "readable by anyone on the path. Put Cloudflare Tunnel or a TLS terminator in front (see deploy/).",
    );
  }

  /* --- the three services, addressed the way the phone addresses them --- */

  let health;
  try {
    health = await getHealth(BASE);
  } catch (e) {
    blocker("engine", `unreachable: ${(e as Error).message}`);
    return report();
  }
  ok("engine", `up · corpus ${health.corpusVersion} · provider ${health.provider}`);

  // The client derives the other two from the engine's address. This is the
  // check that would have caught the hardcoded-port bug: the services were
  // all healthy, and the phone still could not reach two of them.
  const evidenceUrl = defaultEvidenceUrl(BASE);
  const sttUrl = siblingUrl(BASE, { port: 8788, segment: "stt" });

  try {
    const stt = await getSttHealth(sttUrl);
    if (stt.simulated) {
      warn(
        "speech",
        `${sttUrl} is running the mock provider. It cannot hear. Guidance built on canned text ` +
          `describes a situation that is not happening — the app says SIMULATED, but nobody should ` +
          `rely on it. Set KAVACH_STT_PROVIDER=openai-compatible and a key.`,
      );
    } else {
      ok("speech", `${sttUrl} · ${stt.provider}${stt.model ? ` (${stt.model})` : ""}`);
    }
  } catch (e) {
    warn(
      "speech",
      `${sttUrl} unreachable (${(e as Error).message}). The microphone will be disabled; ` +
        `the text composer still works, so this degrades rather than breaks.`,
    );
  }

  try {
    const ev = await getEvidenceHealth(evidenceUrl);
    ok("evidence", `${evidenceUrl} · ${ev.retentionDays}d retention · ${ev.maxSessionMb}MB per session`);
    if (ev.retentionDays > 90) {
      warn(
        "evidence retention",
        `${ev.retentionDays} days. This is audio of encounters with police, and the PRD's open ` +
          `question about who can be compelled to produce it gets worse the longer it is held.`,
      );
    }
  } catch (e) {
    blocker(
      "evidence",
      `${evidenceUrl} unreachable (${(e as Error).message}). PRD R4's whole promise is that a ` +
        `recording outlives the handset. Without this service it does not — and the app will not say so loudly.`,
    );
  }

  /* --- the gate that actually matters ------------------------------ */

  if (health.corpusStatus !== "counsel-signed-off") {
    blocker(
      "corpus",
      `status is "${health.corpusStatus}". Every section number is a placeholder no advocate has ` +
        `read, and users repeat these lines out loud to police officers. The UNVERIFIED banner is ` +
        `on every screen, which is honest, but honest placeholder law is still placeholder law. ` +
        `This is the gate: an advocate signs, corpus/meta.json changes, then this passes.`,
    );
  } else {
    ok("corpus", "counsel-signed-off");
  }

  const review = health.corpusReview;
  if (review) {
    if (review.neverReviewed > 0) {
      // Reported separately from "overdue" because the two mean different
      // things: nobody has started, versus this lapsed.
      warn(
        "corpus review",
        `${review.neverReviewed}/${review.total} corpus items have never been reviewed. ` +
          `Every ${review.reviewIntervalDays} days thereafter, per PRD R6.`,
      );
    } else if (review.overdue > 0) {
      blocker(
        "corpus review",
        `${review.overdue}/${review.total} items are past their review date. Law changes; ` +
          `signed-off content that has lapsed is being presented as current.`,
      );
    } else {
      ok("corpus review", `${review.total} items, none overdue`);
    }
  } else {
    warn("corpus review", "the engine did not report review state — it is running an older build");
  }

  /* --- durability --------------------------------------------------- */

  if (health.persistence === false || health.persistence === undefined) {
    blocker(
      "persistence",
      "the engine holds sessions in memory only. A restart or a redeploy destroys every packet " +
        "in flight — the artifact that makes the encounter worth anything afterwards. Mount a " +
        "real disk and leave KAVACH_PERSIST_SESSIONS alone.",
    );
  } else {
    ok("persistence", `on · ${health.persistence.retentionDays}d retention`);
    if (health.persistence.retentionDays > 30) {
      warn(
        "session retention",
        `${health.persistence.retentionDays} days. These are verbatim transcripts of encounters ` +
          `with police. Longer is not safer.`,
      );
    }
  }

  /* --- authorisation ------------------------------------------------ */

  let authOn = false;
  try {
    await createSession(BASE, null);
    blocker(
      "auth",
      "a session was created with no credential. Anyone who can reach this address can read and " +
        "delete other people's encounters. KAVACH_AUTH is off, or the key is empty.",
    );
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401 || status === 403) {
      authOn = true;
      ok("auth", "an unauthenticated session was refused");
    } else {
      warn("auth", `could not tell whether auth is on: ${(e as Error).message}`);
    }
  }

  if (!KEY) {
    warn(
      "credential",
      "no KAVACH_API_KEY in the environment and no .kavach-secrets.json to read, so the " +
        "end-to-end check below was skipped. Run this with the key a phone would carry.",
    );
  } else {
    let a: Awaited<ReturnType<typeof createSession>> | null = null;
    let b: Awaited<ReturnType<typeof createSession>> | null = null;
    try {
      a = await createSession(BASE, KEY);
      b = await createSession(BASE, KEY);
      ok("credential", "the instance key opens session creation");
    } catch (e) {
      blocker("credential", `the instance key was refused: ${(e as Error).message}`);
    }

    if (a && b) {
      // Containment. A capability for one encounter must not open another —
      // this is the property that stands in for the login the PRD forbids.
      if (authOn) {
        try {
          await sendTurn(BASE, b.sessionId, "test", "officer", a.sessionToken);
          blocker(
            "containment",
            "a session token for one encounter was accepted on another. Every user of this " +
              "deployment can read every other user's transcript.",
          );
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status === 403) ok("containment", "a token for one encounter is refused on another");
          else warn("containment", `unexpected response: ${(e as Error).message}`);
        }
      }

      try {
        const r = await sendTurn(BASE, a.sessionId, "Show me your licence", "officer", a.sessionToken);
        if (r.violations.length > 0) {
          blocker(
            "output guard",
            `the guard tripped on a plain turn (${r.violations.map((v) => v.kind).join(", ")}). ` +
              `The engine degraded to safe actions, which is correct, but it means corpus wording is wrong.`,
          );
        } else {
          ok("guidance loop", `a turn returned guidance in ${r.latencyMs}ms`);
        }
        if (r.latencyMs > 8000) {
          warn("latency", `${r.latencyMs}ms for one turn. The PRD's budget is 8s tap-to-guidance.`);
        }
      } catch (e) {
        blocker("guidance loop", `a turn failed: ${(e as Error).message}`);
      }

      for (const s of [a, b]) {
        try {
          await deleteSession(BASE, s.sessionId, s.sessionToken);
        } catch {
          /* the retention sweep will get it */
        }
      }
    }
  }

  report();
}

function report(): void {
  const blockers = findings.filter((f) => f.level === "blocker");
  const warnings = findings.filter((f) => f.level === "warn");

  for (const f of findings.filter((x) => x.level === "ok")) {
    console.log(`  ${green("✓")} ${f.what.padEnd(16)} ${dim(f.detail)}`);
  }
  for (const f of warnings) {
    console.log(`\n  ${yellow("!")} ${bold(f.what)}\n      ${f.detail}`);
  }
  for (const f of blockers) {
    console.log(`\n  ${red("✗ BLOCKER")} ${bold(f.what)}\n      ${f.detail}`);
  }

  console.log("");
  if (blockers.length > 0) {
    console.log(
      red(bold(`  NOT READY FOR PUBLIC USE — ${blockers.length} blocker(s), ${warnings.length} warning(s)\n`)),
    );
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.log(yellow(bold(`  Deployable, with ${warnings.length} warning(s) you have read.\n`)));
  } else {
    console.log(green(bold("  Ready.\n")));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n${red((e as Error).message)}\n`);
  process.exit(1);
});
