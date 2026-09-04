import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Credentials for the check scripts.
 *
 * The services generate `.kavach-secrets.json` at the repo root on first boot,
 * so a script running on the same machine can read it and stay zero-config.
 * `KAVACH_API_KEY` overrides, which is what a CI run or a remote deployment
 * would use.
 *
 * This convenience is exactly why the file is gitignored and why the services
 * say, on every boot, where their secrets came from.
 */
export function apiKey(): string | null {
  const fromEnv = process.env.KAVACH_API_KEY;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  try {
    const file = path.resolve(process.cwd(), "..", ".kavach-secrets.json");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { apiKey?: string };
    return parsed.apiKey ?? null;
  } catch {
    return null;
  }
}
