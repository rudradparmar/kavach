/**
 * Cross-service authorisation, against all three running services.
 *
 *   cd kavach-engine    && npm run dev   # :8787
 *   cd stt-service      && npm run dev   # :8788
 *   cd evidence-service && npm run dev   # :8789
 *   cd app && npm run auth
 *
 * The unit tests in `kavach-engine/test/run.ts` prove the token logic. This
 * proves the *deployment*: that each service actually calls it, on every route
 * that matters, and that a capability minted by the engine is honoured by two
 * services that have never heard of the engine.
 *
 * The property under test is **containment**. A token for one encounter must
 * not open another, and the audio of somebody's arrest must not be reachable
 * by anyone who can guess a UUID.
 *
 * ## If this fails on a re-run, check for 429 before believing it
 *
 * This script deliberately makes about six failed-credential requests to the
 * engine, and `shared/ratelimit.ts` charges a token for each one (capacity
 * 20, refilling 10/minute). Run it three or four times back to back — or
 * alongside `npm run preflight`, which makes two more — and the bucket
 * empties. The service then answers 429 to a request this script expected to
 * be answered 403, and two checks fail in a way that reads exactly like an
 * auth bug.
 *
 * That is the limiter working. Wait a minute and re-run. The checks that fail
 * first are the ones asserting a specific rejection status, which is why they
 * are the ones that look alarming.
 */

import { randomUUID } from "node:crypto";
import { createSession } from "../src/api/client";
import { apiKey } from "./creds";

const ENGINE = process.argv[2] ?? "http://localhost:8787";
const STT = process.argv[3] ?? "http://localhost:8788";
const EVIDENCE = process.argv[4] ?? "http://localhost:8789";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? green("✓") : red("✗")} ${label}${detail ? dim(`  ${detail}`) : ""}`);
  if (!ok) failures += 1;
};

const KEY = apiKey();

const hdr = (token: string | null): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};

async function status(url: string, init: RequestInit = {}): Promise<number> {
  try {
    return (await fetch(url, init)).status;
  } catch {
    return 0;
  }
}

async function main() {
  console.log(`\n${bold("auth")}  engine ${ENGINE} · speech ${STT} · evidence ${EVIDENCE}`);

  if (!KEY) {
    console.log(red("\n  No API key found. Start a service once to generate .kavach-secrets.json,"));
    console.log(red("  or set KAVACH_API_KEY.\n"));
    process.exit(1);
  }

  // Health stays open on purpose: it is the app's reachability probe, and it
  // discloses only that a service exists.
  console.log(`\n${bold("1. what is deliberately open")}`);
  check("engine /health needs no credential", (await status(`${ENGINE}/health`)) === 200);
  check("speech /health needs no credential", (await status(`${STT}/health`)) === 200);
  check("evidence /health needs no credential", (await status(`${EVIDENCE}/health`)) === 200);

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("2. nothing else is")}`);

  check(
    "the corpus is refused without a key",
    [401, 403].includes(await status(`${ENGINE}/corpus`)),
    `got ${await status(`${ENGINE}/corpus`)}`,
  );
  check(
    "a session cannot be started without a key",
    [401, 403].includes(await status(`${ENGINE}/session`, { method: "POST" })),
  );
  check(
    "a wrong key is refused",
    (await status(`${ENGINE}/session`, { method: "POST", headers: hdr("not-the-key") })) === 403,
  );

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("3. a session capability")}`);

  const a = await createSession(ENGINE, KEY);
  const b = await createSession(ENGINE, KEY);
  check("the engine mints a token with the session", typeof a.sessionToken === "string");

  const tokenA = a.sessionToken;
  const tokenB = b.sessionToken;

  check(
    "the token opens its own session on the engine",
    (await status(`${ENGINE}/session/${a.sessionId}/packet`, { headers: hdr(tokenA) })) === 200,
  );

  // The property the whole design exists for.
  check(
    "it does NOT open a different session on the engine",
    (await status(`${ENGINE}/session/${b.sessionId}/packet`, { headers: hdr(tokenA) })) === 403,
    "containment",
  );

  check(
    "a session with no token is refused",
    [401, 403].includes(await status(`${ENGINE}/session/${a.sessionId}/packet`)),
  );

  check(
    "a session token is not an instance key",
    [401, 403].includes(await status(`${ENGINE}/corpus`, { headers: hdr(tokenA) })),
  );

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("4. the other two services honour it")}`);

  // Neither of these has ever heard of the engine. They verify the signature.
  check(
    "evidence accepts the token for its own session",
    (await status(`${EVIDENCE}/session/${a.sessionId}/acks`, { headers: hdr(tokenA) })) === 200,
  );
  check(
    "evidence refuses it for another session",
    (await status(`${EVIDENCE}/session/${b.sessionId}/acks`, { headers: hdr(tokenA) })) === 403,
    "containment",
  );
  check(
    "evidence refuses an unauthenticated read of someone's audio",
    [401, 403].includes(await status(`${EVIDENCE}/session/${a.sessionId}/manifest`)),
  );
  check(
    "evidence refuses an unauthenticated DELETE",
    [401, 403].includes(await status(`${EVIDENCE}/session/${a.sessionId}`, { method: "DELETE" })),
  );
  check(
    "a guessed session id gets nothing",
    [401, 403].includes(await status(`${EVIDENCE}/session/${randomUUID()}/manifest`)),
  );

  const body = new Uint8Array(64).fill(3);
  check(
    "speech refuses audio without a token",
    [401, 403].includes(
      await status(`${STT}/transcribe`, {
        method: "POST",
        headers: { "content-type": "audio/m4a" },
        body,
      }),
    ),
  );
  check(
    "speech accepts a valid session token",
    (await status(`${STT}/transcribe`, {
      method: "POST",
      headers: { "content-type": "audio/m4a", ...hdr(tokenA) },
      body,
    })) === 200,
  );

  /* ---------------------------------------------------------------- */
  console.log(`\n${bold("5. forgery")}`);

  const forged = `${(tokenA ?? "").slice(0, -1)}X`;
  check(
    "a tampered signature is refused by the engine",
    (await status(`${ENGINE}/session/${a.sessionId}/packet`, { headers: hdr(forged) })) === 403,
  );
  check(
    "a tampered signature is refused by evidence",
    (await status(`${EVIDENCE}/session/${a.sessionId}/acks`, { headers: hdr(forged) })) === 403,
  );

  // Clean up after ourselves; these were real sessions on a real engine.
  for (const s of [a, b]) {
    await fetch(`${ENGINE}/session/${s.sessionId}`, { method: "DELETE", headers: hdr(s.sessionToken) });
  }

  console.log(`\n${failures === 0 ? green("auth OK") : red(`${failures} failure(s)`)}\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(red(`\n${(e as Error).message}\n`));
  console.error(dim("All three services must be running.\n"));
  process.exit(1);
});
