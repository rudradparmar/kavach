import { authHeaders } from "./auth";
import type { CorpusPayload, Health, IncidentPacket, SessionCreated, Speaker, TurnResult } from "./types";

/**
 * The engine client. Thin on purpose.
 *
 * This file does not interpret anything it receives. It does not decide when
 * to show a warning, does not reword an option, does not synthesise guidance
 * on a failure. The engine is the only thing in this system allowed to say
 * what the law is; the client's whole job is to carry bytes and render them.
 */

/** A hung request is worse than a failed one — the user is standing at a
 *  checkpoint watching a spinner. Fail fast enough to say something useful. */
const TIMEOUT_MS = { health: 4_000, session: 8_000, turn: 20_000, corpus: 15_000, packet: 20_000 } as const;

export class EngineError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "timeout" | "http" | "malformed",
    readonly status?: number,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal });
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    throw new EngineError(
      aborted
        ? `The engine did not respond within ${Math.round(timeoutMs / 1000)}s.`
        : `Could not reach the engine at ${baseUrl}.`,
      aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timer);
  }

  const body = await res.text();

  if (!res.ok) {
    let detail = body.slice(0, 200);
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) detail = parsed.error;
    } catch {
      // Non-JSON error body; the raw text is the best detail available.
    }
    throw new EngineError(`Engine returned ${res.status}: ${detail}`, "http", res.status);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new EngineError("Engine returned a response this client could not parse.", "malformed");
  }
}

export function getHealth(baseUrl: string): Promise<Health> {
  return request<Health>(baseUrl, "/health", { method: "GET" }, TIMEOUT_MS.health);
}

export function createSession(baseUrl: string, apiKey: string | null): Promise<SessionCreated> {
  return request<SessionCreated>(
    baseUrl,
    "/session",
    { method: "POST", headers: authHeaders(apiKey) },
    TIMEOUT_MS.session,
  );
}

export function sendTurn(
  baseUrl: string,
  sessionId: string,
  text: string,
  speaker: Speaker,
  token: string | null,
): Promise<TurnResult> {
  return request<TurnResult>(
    baseUrl,
    `/session/${encodeURIComponent(sessionId)}/turn`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(token) },
      body: JSON.stringify({ text, speaker }),
    },
    TIMEOUT_MS.turn,
  );
}

/**
 * The incident packet (PRD R8) as structured data.
 *
 * Rendered from the JSON rather than the markdown so that flags, provisions
 * and severities go through the same components as the live screens — an
 * advocate should not be reading a differently-styled account of the same
 * facts, and a markdown renderer would be a second place for corpus text to
 * get reformatted.
 */
export function getPacketJson(baseUrl: string, sessionId: string, token: string | null): Promise<IncidentPacket> {
  return request<IncidentPacket>(
    baseUrl,
    `/session/${encodeURIComponent(sessionId)}/packet?format=json`,
    { method: "GET", headers: authHeaders(token) },
    TIMEOUT_MS.packet,
  );
}

/** The same packet as markdown — what actually gets shared. */
export async function getPacketMarkdown(baseUrl: string, sessionId: string, token: string | null): Promise<string> {
  const url = `${baseUrl}/session/${encodeURIComponent(sessionId)}/packet`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS.packet);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: authHeaders(token) });
    if (!res.ok) throw new EngineError(`Engine returned ${res.status} for the packet.`, "http", res.status);
    return await res.text();
  } catch (e) {
    if (e instanceof EngineError) throw e;
    const aborted = (e as Error)?.name === "AbortError";
    throw new EngineError(
      aborted ? "The packet took too long to build." : `Could not reach the engine at ${baseUrl}.`,
      aborted ? "timeout" : "network",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Permanent deletion (PRD R4: "the user can permanently delete a session's
 * evidence, and deletion is honoured within 24 hours").
 *
 * Immediate on the engine — it drops the session from memory and removes the
 * file. There is nothing to undo afterwards, which is the point, so the caller
 * confirms first.
 */
export function deleteSession(baseUrl: string, sessionId: string, token: string | null): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    baseUrl,
    `/session/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: authHeaders(token) },
    TIMEOUT_MS.session,
  );
}

/** Direct URL, for anything that needs to fetch the markdown itself. */
export function packetUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl}/session/${encodeURIComponent(sessionId)}/packet`;
}

/**
 * The whole corpus, for the offline cache (PRD R10).
 *
 * ~31KB. Small enough to keep on the device in full, which is the point: the
 * PRD is explicit that policing is heaviest where signal is worst, so the ten
 * scenarios have to be readable with no network and no model call.
 */
export function getCorpus(baseUrl: string, apiKey: string | null): Promise<CorpusPayload> {
  return request<CorpusPayload>(baseUrl, "/corpus", { method: "GET", headers: authHeaders(apiKey) }, TIMEOUT_MS.corpus);
}
