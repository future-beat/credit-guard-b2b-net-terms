import { randomUUID } from "node:crypto";

import * as Sentry from "@sentry/react-router";
import {
  schedule as scheduleCronTask,
  shutdown as shutdownCronTasks,
  type ScheduledTask,
} from "node-cron";

import db from "../db.server";
import { recomputeCompany } from "./ledger.server";
import { publishCompanyCreditState } from "./metafields.server";
import {
  runAttributionHealSweep,
  runReconciliationSweep,
} from "./reconciliation.server";
import {
  REMINDER_SWEEP_CRON,
  REMINDER_SWEEP_LEASE,
  reminderSweep,
} from "./reminders.server";

/**
 * The phase's time axis (LEDG-05, D-04/D-05) — and the scheduler loop Phase 5
 * reuses for reminder emails.
 *
 * Nothing in Shopify fires a webhook because time passed. A company whose
 * payment schedule quietly slid past `dueAt` stays "not overdue" forever unless
 * something re-evaluates it on a clock, which is what this module is. Two
 * cadences (D-05):
 *
 *   hourly  0 * * * *   overdueSweep          — cheap indexed pass over due dates,
 *                                                plus the credit_v1 publish
 *                                                backstop (CRED-03, L-02)
 *   daily   30 3 * * *  runReconciliationSweep — full re-derivation from Shopify
 *   5-min   every 5m   runAttributionHealSweep — attribution backstop, gated
 *                                                on one indexed read per shop
 *                                                (06-DEBUG-ingest-latency)
 *   hourly  30 * * * *  reminderSweep          — Phase 5's dunning calendar
 *                                                (REMD-01), on its OWN lease
 *
 * Four rules hold here, and for every sweep added later:
 *
 * 1. `forEachActiveShop` IS THE SHOP ENUMERATOR. No sweep may query the Shop
 *    table itself. `Shop.active = false` means the merchant uninstalled and
 *    their rows are being retained through the 48h grace window (D-06) — doing
 *    background work for them is unauthorized processing, so the gate lives in
 *    the iteration primitive where it cannot be forgotten rather than in each
 *    caller (carry-forward CF-3, threat T-02-17). A source-guard test in
 *    tests/scheduler.test.ts fails if a second enumerator ever appears.
 * 2. IDEMPOTENCY IS THE CORRECTNESS PROPERTY, THE LEASE IS ONLY HYGIENE. Both
 *    sweeps recompute from source, so running one twice concurrently writes the
 *    same values. `runExclusive` exists to stop Railway's deploy-overlap window
 *    (two containers live at once) from burning API quota and, in Phase 5,
 *    double-sending merchant-visible email — not to make the writes safe. Never
 *    reason "the lease held, therefore this can skip its idempotency."
 * 3. NO ADVISORY LOCKS. Postgres advisory locks are session-scoped and Prisma's
 *    pool can acquire on one connection and release on another. The lease is a
 *    row claimed by one atomic UPDATE instead (research § Scheduler).
 * 4. THE OVERDUE FLIP GOES THROUGH `recomputeCompany`. This module never writes
 *    Company.overdue directly — a second writer of that column re-opens the
 *    balance-drift bug the whole phase exists to prevent (ledger rule 3).
 *
 * D-04 has no grace period and the comparison is STRICTLY past: a schedule due
 * at the exact sweep instant is not yet late, and flips at the next sweep.
 */

/* ------------------------------------------------------------------ *
 * Cadence and lease identity.
 * ------------------------------------------------------------------ */

/** Hourly — LEDG-05's "no merchant action required" flip. */
export const OVERDUE_SWEEP_CRON = "0 * * * *";
/** Daily, off-peak — LEDG-04's source-of-truth re-derivation. */
export const RECONCILIATION_CRON = "30 3 * * *";

/**
 * Every five minutes — the attribution backstop (06-DEBUG-ingest-latency).
 *
 * Affordable at this cadence because the tick is gated on ONE indexed read per
 * shop: a shop with no unresolved net-terms order makes zero Admin API calls.
 * What it buys is the ceiling on how long a new B2B order can sit outside its
 * company's exposure — minutes instead of "until 03:30 tomorrow" — which is
 * the difference between a checkout hold that works and one that does not.
 */
export const ATTRIBUTION_HEAL_CRON = "*/5 * * * *";

/**
 * Lease names. Stable strings: they are rows in `SweepLease`, and Phase 5 adds
 * its own name here rather than sharing one of these — two different sweeps
 * behind one lease would let a slow reconciliation suppress reminder emails.
 */
export const OVERDUE_SWEEP_LEASE = "overdue-sweep";
export const RECONCILIATION_LEASE = "reconciliation";
/**
 * The attribution heal's OWN lease. Sharing `reconciliation` would let one
 * daily run hold the claim (up to LEASE_DURATION_MINUTES) while every fast
 * tick underneath it silently no-ops — the 24h latency defect restored behind
 * a shorter cron string.
 */
export const ATTRIBUTION_HEAL_LEASE = "attribution-heal";

/**
 * How long a claim is held before another container may steal it. Long enough
 * that a slow reconciliation is not overtaken mid-run, short enough that a
 * container killed without running its `finally` (SIGKILL) does not wedge the
 * sweep for a day.
 */
export const LEASE_DURATION_MINUTES = 30;

/** Seconds `stopScheduler` waits for an in-flight sweep before destroying tasks. */
const SHUTDOWN_GRACE_MS = 10_000;

/**
 * Who holds a lease. Railway sets `RAILWAY_DEPLOYMENT_ID` per deployment, which
 * is exactly the identity that differs between the old and new container during
 * the overlap window; the UUID fallback covers local runs. Deliberately reuses
 * a platform variable rather than introducing an app-specific env var name.
 */
export const INSTANCE_ID =
  process.env.RAILWAY_DEPLOYMENT_ID ?? `local-${randomUUID()}`;

/* ------------------------------------------------------------------ *
 * CF-3: the only way a sweep is allowed to see a shop.
 * ------------------------------------------------------------------ */

/**
 * Run `fn` for every ACTIVE shop, in domain order.
 *
 * The `active: true` filter is the authorization decision for all background
 * work — sweeps carry no request and therefore no per-request auth, so this
 * predicate is the entire access-control story (threat T-02-17). Keeping it
 * here, rather than in each sweep, is what makes CF-3 structural: a new sweep
 * gets the gate by construction and cannot forget it.
 *
 * One failing shop must never stop the ledger for every other merchant, so
 * per-shop errors are reported and stepped over. Returns the number of shops
 * enumerated (including the ones that failed).
 */
export async function forEachActiveShop(
  fn: (shop: string) => Promise<void>,
): Promise<number> {
  const activeShops = await db.shop.findMany({
    where: { active: true },
    select: { domain: true },
    orderBy: { domain: "asc" },
  });

  for (const { domain } of activeShops) {
    try {
      await fn(domain);
    } catch (error) {
      // Swallowed on purpose — but never silently. A shop whose sweep threw is
      // a shop whose credit state is now stale, which is exactly the condition
      // that produces a wrong checkout decision.
      Sentry.captureException(error, {
        tags: { sweep: "forEachActiveShop", shop: domain },
      });
      console.error(`Sweep failed for ${domain}:`, error);
    }
  }

  return activeShops.length;
}

/* ------------------------------------------------------------------ *
 * Lease — deploy-overlap hygiene (research Pitfall 6).
 * ------------------------------------------------------------------ */

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Make sure the lease row exists. Tolerant of the race where both containers
 * reach an unseeded lease at once: the loser's unique violation is the correct
 * outcome, not an error.
 */
async function ensureLeaseRow(name: string): Promise<void> {
  try {
    await db.sweepLease.create({
      // Epoch expiry = "free". The first claimant takes it immediately.
      data: { name, holder: "", lockedUntil: new Date(0) },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

/**
 * Run `fn` only if this instance wins the lease; return whether it ran.
 *
 * The claim is ONE statement — the UPDATE both tests expiry and takes ownership,
 * so two containers racing produce exactly one affected row. A read-then-write
 * would let both read "free" and both proceed.
 *
 * Losing is not an error and is not logged as one: during a Railway deploy the
 * outgoing container legitimately loses every tick until it drains. And because
 * both sweeps are idempotent, even a lost race that somehow ran twice would
 * write identical values (rule 2).
 *
 * `holder` is a parameter rather than a constant so a test can simulate a second
 * container without spawning one.
 */
export async function runExclusive(
  name: string,
  fn: () => Promise<void>,
  holder: string = INSTANCE_ID,
): Promise<boolean> {
  await ensureLeaseRow(name);

  const claimed = await db.$executeRaw`
    UPDATE "SweepLease"
       SET "holder" = ${holder},
           "lockedUntil" = now() + (${LEASE_DURATION_MINUTES} || ' minutes')::interval
     WHERE "name" = ${name}
       AND "lockedUntil" < now()`;

  if (claimed === 0) return false;

  try {
    await fn();
    return true;
  } finally {
    // Release by expiring the claim, scoped to this holder so a run that
    // overshot its lease cannot release the lease its successor now owns.
    await db.$executeRaw`
      UPDATE "SweepLease"
         SET "lockedUntil" = now()
       WHERE "name" = ${name}
         AND "holder" = ${holder}`;
  }
}

/* ------------------------------------------------------------------ *
 * The hourly overdue sweep (LEDG-05, D-04/D-05).
 * ------------------------------------------------------------------ */

/**
 * Companies on one shop whose credit state may have changed purely because the
 * clock moved. Two sets, unioned:
 *
 *  - companies with an OPEN schedule strictly past `dueAt` on a live order —
 *    the flip TO overdue. Served by `LedgerSchedule @@index([shop, dueAt])`,
 *    which is what makes an hourly cadence cheap (D-05);
 *  - companies currently FLAGGED overdue — the flip back OFF. Normally a
 *    payment webhook clears the flag, but if that delivery was missed the
 *    company stays blocked at checkout until tomorrow's reconciliation. A
 *    falsely-blocked paying customer is the project's worst failure mode, so
 *    the hourly pass re-checks them too; the set is tiny and served by
 *    `Company @@index([shop, overdue])`.
 */
async function companiesToReevaluate(shop: string, now: Date): Promise<string[]> {
  const pastDue = await db.ledgerSchedule.findMany({
    where: {
      shop,
      completedAt: null,
      // STRICTLY past (D-04): due exactly now is not yet late. Also excludes
      // NULL dueAt, which SQL comparison drops on its own.
      dueAt: { lt: now },
      order: { cancelledAt: null, companyId: { not: null } },
    },
    select: { order: { select: { company: { select: { companyGid: true } } } } },
  });

  const flagged = await db.company.findMany({
    where: { shop, overdue: true },
    select: { companyGid: true },
  });

  const gids = new Set<string>();
  for (const row of pastDue) {
    const gid = row.order.company?.companyGid;
    if (gid) gids.add(gid);
  }
  for (const row of flagged) gids.add(row.companyGid);

  return [...gids];
}

/**
 * Re-derive credit state for every company whose overdue status could have
 * changed since the last tick, on active shops only.
 *
 * `now` is injected rather than read inside so the strict-past boundary is
 * testable to the millisecond, and it is threaded into `recomputeCompany` so the
 * persisted flag reflects the sweep instant rather than a few milliseconds later.
 */
/**
 * Publish every company of one shop, hash-skipped (CRED-03, L-02).
 *
 * THIS IS THE RETRY CHANNEL, and the reason there is no queue. Publishing is
 * deliberately non-throwing inside `recomputeCompany` (metafields rule 8): a
 * metafield blip must not 500 a webhook whose ledger work already committed.
 * The cost of that choice is a lost write, marked by `publishedAt <
 * recomputedAt`, and something has to come back for it. An outbox table plus a
 * drain worker is the enterprise answer; at ICP scale this pass over the
 * existing hourly lease is the same guarantee for ~10 lines and no new failure
 * modes (research § "outbox-lite" / Don't Hand-Roll).
 *
 * It is also the ONLY correction path for `data_complete`, which is SHOP-scoped
 * (L-01): when one unattributed net-terms order appears, every company of that
 * shop has a wrong payload and NO webhook names them. The flag participates in
 * the state hash, so a flip changes every hash and this pass republishes them
 * all — then stops. That is the bound (L-02): enumeration is unconditional, but
 * WRITES are hash-gated, so a steady-state shop costs one DB read per company
 * and ZERO metafieldsSet calls (threat T-03-11).
 *
 * No second try/catch: `publishCompanyCreditState` already swallows and Sentry-
 * tags its own failures, so one company's failure cannot stop the next, and
 * wrapping it again would only strip that context. It also re-checks
 * `Shop.active` internally — with `forEachActiveShop` above, an uninstalled
 * merchant is double-gated (T-03-16).
 *
 * Placed AFTER the recompute loop on purpose: companies just recomputed are
 * already published inline, so they hash-skip their second touch here.
 */
async function publishBackstop(shop: string): Promise<void> {
  const companies = await db.company.findMany({
    where: { shop },
    select: { id: true },
    // Deterministic order so a partial pass (container killed mid-sweep)
    // resumes over the same sequence rather than a random one.
    orderBy: { companyGid: "asc" },
  });

  for (const { id } of companies) {
    await publishCompanyCreditState(shop, id);
  }
}

export async function overdueSweep(now: Date = new Date()): Promise<void> {
  await forEachActiveShop(async (shop) => {
    for (const companyGid of await companiesToReevaluate(shop, now)) {
      await recomputeCompany(shop, companyGid, now);
    }

    await publishBackstop(shop);
  });
}

/* ------------------------------------------------------------------ *
 * Registration — the wiring, as data.
 * ------------------------------------------------------------------ */

export interface SweepRegistration {
  /** `SweepLease.name` this sweep claims before running. */
  lease: string;
  /** node-cron expression. */
  expression: string;
  /** Skip a tick while the previous run is still going (node-cron 4 option). */
  noOverlap: boolean;
  run: () => Promise<void>;
}

/**
 * Every scheduled sweep, as inspectable data rather than buried in a start
 * function — so the wiring (which sweep, what cadence, which lease) is asserted
 * by a test that compares values instead of by a regex over source text.
 *
 * Phase 5's reminder sweep took the reserved third slot with its OWN lease name
 * (05-01), exactly as this comment prescribed — no new cron infrastructure and
 * no second scheduler.
 */
export const SWEEP_SCHEDULE: SweepRegistration[] = [
  {
    lease: OVERDUE_SWEEP_LEASE,
    expression: OVERDUE_SWEEP_CRON,
    noOverlap: true,
    run: overdueSweep,
  },
  {
    lease: RECONCILIATION_LEASE,
    expression: RECONCILIATION_CRON,
    noOverlap: true,
    run: runReconciliationSweep,
  },
  {
    // Phase 5's dunning tick (REMD-01), on its own lease and offset to minute
    // 30 so it never queues behind the minute-0 ledger pass. Cadence and lease
    // name live in reminders.server.ts with the feature they belong to.
    lease: REMINDER_SWEEP_LEASE,
    expression: REMINDER_SWEEP_CRON,
    noOverlap: true,
    run: reminderSweep,
  },
  {
    // The attribution backstop (06-DEBUG fix 2): pass 3 of the reconciliation,
    // alone, every five minutes, and only for shops that actually have an
    // unresolved net-terms order. Its own lease, per the rule above.
    lease: ATTRIBUTION_HEAL_LEASE,
    expression: ATTRIBUTION_HEAL_CRON,
    noOverlap: true,
    run: runAttributionHealSweep,
  },
];

declare global {
  // eslint-disable-next-line no-var
  var creditGuardSchedulerTasks: ScheduledTask[] | undefined;
}

/**
 * Whether this process should run sweeps at all.
 *
 * Tests and builds import the server entry (and therefore this module) but must
 * never start a timer — a suite that schedules real cron tasks either hangs or
 * races the fixtures it is asserting on. Deliberately checks only variables that
 * already exist (`VITEST`, `NODE_ENV`); no new configuration surface.
 */
export function schedulerEnabled(): boolean {
  return !process.env.VITEST && process.env.NODE_ENV !== "test";
}

/**
 * Start the in-process scheduler. Idempotent, and safe to call from module
 * scope: the `globalThis` guard copies db.server.ts's singleton pattern so a dev
 * hot-reload re-importing this module cannot end up with two live schedulers.
 *
 * Returns whether it started, so the caller (and tests) can tell "already
 * running" and "disabled here" from "started".
 *
 * `force` exists for the shutdown test, which needs real tasks to stop.
 */
export function startScheduler(options: { force?: boolean } = {}): boolean {
  if (!options.force && !schedulerEnabled()) return false;
  if (globalThis.creditGuardSchedulerTasks) return false;

  globalThis.creditGuardSchedulerTasks = SWEEP_SCHEDULE.map((sweep) =>
    // node-cron 4: tasks start on creation (`scheduled: false` was removed);
    // `unref` keeps the heartbeat timer from being the only thing holding the
    // process open, so shutdown is decided by the HTTP server, not by cron.
    scheduleCronTask(
      sweep.expression,
      () => runExclusive(sweep.lease, sweep.run),
      {
        name: sweep.lease,
        noOverlap: sweep.noOverlap,
        unref: true,
      },
    ),
  );

  process.once("SIGTERM", handleSigterm);
  return true;
}

/** How many cron tasks this process currently has registered. */
export function scheduledTaskCount(): number {
  return globalThis.creditGuardSchedulerTasks?.length ?? 0;
}

/**
 * Stop every registered task, letting an in-flight sweep iteration finish.
 *
 * A mid-sweep kill is harmless — the next run re-derives everything from source
 * — so the grace window is about not leaving a half-written company recompute,
 * not about completing the sweep.
 */
export async function stopScheduler(): Promise<void> {
  const tasks = globalThis.creditGuardSchedulerTasks;
  globalThis.creditGuardSchedulerTasks = undefined;
  process.off("SIGTERM", handleSigterm);
  if (!tasks) return;

  // node-cron 4's graceful drain: stop every task, wait out any execution
  // already in flight (bounded), then destroy.
  await shutdownCronTasks(SHUTDOWN_GRACE_MS);
}

/**
 * Railway sends SIGTERM to the outgoing container after the deploy-overlap
 * window. Stop scheduling promptly so the incoming container owns the leases.
 */
export function handleSigterm(): void {
  void stopScheduler().catch((error) => {
    Sentry.captureException(error, { tags: { sweep: "shutdown" } });
    console.error("Scheduler shutdown failed:", error);
  });
}
