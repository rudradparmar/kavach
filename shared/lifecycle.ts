/**
 * Process lifecycle: retention that keeps running, and shutdown that finishes
 * what it started.
 *
 * Both services had the same two holes, and both were invisible.
 *
 * **Retention swept only at boot.** `sweep()` ran once before `listen()` and
 * never again. That is fine for a process restarted constantly and useless for
 * one that stays up — which is the entire point of choosing a host that never
 * sleeps. A deployment left running for a month kept every session and every
 * chunk of audio in it, past every stated retention bound, and reported
 * nothing.
 *
 * This matters more than tidiness. Persisting a police encounter is a trade:
 * the packet survives a crash, and in exchange a verbatim transcript of an
 * interaction with police sits on a disk. Deletion, bounded retention and an
 * off switch are what make that trade defensible. A retention policy that
 * never executes is not half a policy — it is none, while still being
 * described to users as one.
 *
 * **No graceful shutdown.** No service handled SIGTERM, so every redeploy cut
 * in-flight requests. For evidence-service that means a chunk upload dropped
 * mid-write, and a chunk the phone believes was acknowledged is a chunk the
 * phone deletes.
 */

import type { Server } from "node:http";

const MINUTE_MS = 60_000;

/** Hours between sweeps. Six bounds the overshoot without being chatty. */
const DEFAULT_INTERVAL_MINUTES = 6 * 60;

export interface SweepOptions {
  /** Named in the log line, e.g. "session store". */
  label: string;
  /** Performs one sweep and returns how many things it removed. */
  sweep: () => number;
  /** Overrides KAVACH_SWEEP_INTERVAL_MINUTES. Tests use seconds-scale values. */
  intervalMinutes?: number;
  /** Injectable for tests. */
  log?: (message: string) => void;
}

export interface PeriodicSweep {
  /** Minutes between runs, after env and defaults are resolved. */
  readonly intervalMinutes: number;
  /** How many the sweep at startup removed, so callers can log it as before. */
  readonly sweptAtBoot: number;
  /** Runs a sweep immediately. Returns the count. */
  runNow(): number;
  /** Stops the timer. Idempotent. */
  stop(): void;
}

export function sweepIntervalMinutes(override?: number): number {
  if (typeof override === "number" && override > 0) return override;
  const raw = Number(process.env.KAVACH_SWEEP_INTERVAL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MINUTES;
}

/**
 * Sweeps now, then on a timer for as long as the process lives.
 *
 * The timer is `unref`'d so it never by itself keeps the process alive — the
 * HTTP server is what does that. Without this a test that starts a sweep would
 * hang instead of exiting.
 */
export function startRetentionSweep(opts: SweepOptions): PeriodicSweep {
  const intervalMinutes = sweepIntervalMinutes(opts.intervalMinutes);
  const log = opts.log ?? ((m: string) => console.log(m));

  const run = (): number => {
    let removed = 0;
    try {
      removed = opts.sweep();
    } catch (e) {
      // A failed sweep must never take the service down with it. Retention
      // that is late is recoverable; a service that is down is not.
      log(`  ${opts.label}: sweep failed — ${(e as Error).message}`);
      return 0;
    }
    if (removed > 0) log(`  ${opts.label}: swept ${removed} past retention`);
    return removed;
  };

  const sweptAtBoot = run();
  const timer = setInterval(run, intervalMinutes * MINUTE_MS);
  timer.unref?.();

  let stopped = false;
  return {
    intervalMinutes,
    sweptAtBoot,
    runNow: run,
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
    },
  };
}

export interface ShutdownOptions {
  label: string;
  server: Server;
  /** Run after the server stops accepting, before exit. */
  onStop?: () => void;
  log?: (message: string) => void;
  /** Milliseconds to wait for in-flight requests before exiting anyway. */
  graceMs?: number;
}

/**
 * Stops accepting new connections, lets in-flight requests finish, then exits.
 *
 * Bounded, because a hung request must not stop a deploy: after `graceMs` the
 * process exits regardless. Ten seconds is comfortably longer than the
 * longest legitimate request here, which is a 25MB chunk upload.
 */
export function installShutdown(opts: ShutdownOptions): void {
  const log = opts.log ?? ((m: string) => console.log(m));
  const graceMs = opts.graceMs ?? 10_000;
  let shuttingDown = false;

  const stop = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`\n${opts.label}: ${signal} — finishing in-flight requests`);

    const timer = setTimeout(() => {
      log(`${opts.label}: grace period elapsed, exiting anyway`);
      process.exit(0);
    }, graceMs);
    timer.unref?.();

    opts.server.close(() => {
      try {
        opts.onStop?.();
      } finally {
        log(`${opts.label}: stopped cleanly`);
        process.exit(0);
      }
    });
  };

  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}
