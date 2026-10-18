import * as Sentry from "@sentry/react-router";
import { HttpResponseError } from "@shopify/shopify-api";

import db from "../db.server";
import { deactivateShop } from "./shop-lifecycle.server";

/**
 * Token health — the WINDOWS #30 strike counter.
 *
 * The problem it solves: six of seven "active" production shops had offline
 * tokens Shopify would no longer refresh (the store was deleted, or the app was
 * removed without an `app/uninstalled` ever reaching us). Nothing noticed. Every
 * hourly sweep, every 5-minute attribution heal and every daily reconciliation
 * kept constructing a client for them, failing, and logging — forever, with the
 * shop still flagged `active` and still counted as an installed merchant.
 *
 * A revoked token that cannot be refreshed IS an uninstall we were never told
 * about. So after enough evidence, this module treats it as one: `deactivateShop`
 * (D-06 retain — the rows survive) plus a delete of the dead session rows.
 *
 * WHAT COUNTS AS EVIDENCE (the closed list — CONTEXT §3, verified against the
 * installed library):
 *
 *   1. `refresh-failed`         — `unauthenticated.admin(shop)` itself throws a
 *      bare `Response` with `status === 500`. That is helpers/refresh-token.mjs:
 *      it rethrows only `InvalidJwtError` and `HttpResponseError` 400
 *      `invalid_subject_token` as-is and collapses EVERY other refresh error
 *      into `new Response(undefined, { status: 500 })`.
 *   2. `invalid-subject-token`  — `HttpResponseError` with `response.code === 400`
 *      and `response.body.error === "invalid_subject_token"`: Shopify's explicit
 *      "this refresh token is not valid".
 *   3. `unauthorized`           — `HttpResponseError` with `response.code === 401`
 *      thrown by `admin.graphql()`. `unauthenticated.admin` installs no
 *      `handleClientError`, so `throwFailedRequest` in lib/clients/common.mjs
 *      surfaces the raw 401.
 *
 * WHAT NEVER COUNTS, and must never be added: network errors and timeouts,
 * Shopify 5xx, throttling (`HttpThrottlingError`), any other 4xx, GraphQL
 * `userErrors`, `LedgerGraphqlError`, and `SessionNotFoundError` (no session at
 * all is the uninstall path the webhooks already handle, not a dead token).
 *
 * AND, explicitly: ANY resolved `graphql()` call is a HEALTHY call and resets
 * the counter — including a 200 whose body carries GraphQL-level `errors[]`.
 * An `ACCESS_DENIED` in `errors[]` after a scope release is the app talking to
 * Shopify with a working token and being told "not with those scopes"; it is a
 * consent problem, not a token problem, and it heals on re-consent. Only the
 * three throws above are strikes. `graphqlJson` converts `errors[]` into a
 * `LedgerGraphqlError` one layer ABOVE this one, after the reset has happened.
 *
 * Class (1) is deliberately coarse: it also absorbs a refresh-time network
 * blip, because the library gives us no way to tell the two apart (T-Q30-06).
 * The STRIKE MODEL is the mitigation:
 *
 *   - `graphqlJson` constructs a client per GraphQL call, so one hourly sweep
 *     over N companies during a transient token-endpoint hiccup would deliver N
 *     failures within seconds. Strikes are therefore TIME-GATED to one per
 *     TOKEN_FAILURE_WINDOW_MS: a whole sweep's burst counts once. Without that
 *     gate a LIVE merchant would be deactivated in a single bad minute —
 *     silently stopping their overdue flip, publish backstop, reminders and
 *     reconciliation, which is the exact failure this product exists to prevent.
 *   - The window anchor is FIXED at strike time and never slides. A sliding
 *     window would starve a genuinely dead shop of its second strike forever:
 *     `runAttributionHealSweep` reaches this seam every 5 minutes for any shop
 *     with an UNRESOLVED net-terms order, so each failure would keep pushing the
 *     anchor forward and the count would never reach 3.
 *   - Deactivation therefore needs TOKEN_FAILURE_THRESHOLD strikes in separate
 *     windows — three separate sweep cycles, ≥ ~2 h at the hourly cadence
 *     (≥ ~1 h for a shop the 5-minute heal sweep touches) with not one
 *     successful Admin call in between.
 *   - It is reversible: `ensureShopActive` flips the shop back on the
 *     merchant's next authenticated load (D-06), and every non-session row was
 *     retained.
 *
 * The counter lives in `SyncCursor` (key `token-failures`, JSON value) rather
 * than a new column, because a hotfix must not carry a schema migration.
 *
 * The read-modify-write is NOT atomic, and does not need to be: two overlapping
 * processes (a Railway deploy window) inside the same window read the same
 * anchor and write the same count, so the race is at worst an undercount — it
 * can never manufacture an extra strike from a single failure.
 *
 * DELETE BUDGET: `clearTokenFailures` is called on every successful GraphQL
 * call, and `graphqlJson` builds a new client per call — so without the
 * process-level `healthyShops` set an hourly sweep would issue one DELETE per
 * company. The set bounds it to one DELETE per shop per process lifetime, plus
 * one more each time a failure is recorded (which re-arms it).
 */

/** The SyncCursor key the strike record lives under. */
export const TOKEN_FAILURE_KEY = "token-failures";
/** Strikes, in separate windows, before a shop is treated as uninstalled. */
export const TOKEN_FAILURE_THRESHOLD = 3;
/** Inside one hourly sweep cadence, outside two — see the header. */
export const TOKEN_FAILURE_WINDOW_MS = 30 * 60 * 1000;

export type TokenFailureReason =
  | "refresh-failed"
  | "invalid-subject-token"
  | "unauthorized";

interface TokenFailureRecord {
  count: number;
  lastAt: string | null;
  lastReason?: TokenFailureReason;
}

/**
 * Shops confirmed healthy (one successful GraphQL call) since process start.
 * Module-level on purpose: see the DELETE BUDGET note in the header.
 */
const healthyShops = new Set<string>();

/**
 * Classify a failure thrown by `unauthenticated.admin(shop)` — i.e. before any
 * GraphQL runs. Returns null for everything that is not token-class.
 */
export function classifyConstructionFailure(
  error: unknown,
): TokenFailureReason | null {
  // helpers/refresh-token.mjs collapses a failed refresh into a bare 500.
  if (error instanceof Response) {
    return error.status === 500 ? "refresh-failed" : null;
  }

  if (error instanceof HttpResponseError) {
    const body = error.response.body as { error?: unknown } | undefined;
    if (error.response.code === 400 && body?.error === "invalid_subject_token") {
      return "invalid-subject-token";
    }
  }

  return null;
}

/**
 * Classify a failure thrown by `admin.graphql()`. Only a raw 401 is token-class;
 * a resolved response — even one carrying GraphQL `errors[]` — never reaches
 * here at all.
 */
export function classifyRequestFailure(
  error: unknown,
): TokenFailureReason | null {
  if (error instanceof HttpResponseError && error.response.code === 401) {
    return "unauthorized";
  }

  return null;
}

function parseRecord(value: string | undefined): TokenFailureRecord {
  if (!value) return { count: 0, lastAt: null };

  try {
    const parsed = JSON.parse(value) as Partial<TokenFailureRecord>;
    return {
      count: typeof parsed.count === "number" ? parsed.count : 0,
      lastAt: typeof parsed.lastAt === "string" ? parsed.lastAt : null,
      lastReason: parsed.lastReason,
    };
  } catch {
    // A malformed value is treated as no evidence at all — a corrupted row must
    // never be the thing that deactivates a merchant.
    return { count: 0, lastAt: null };
  }
}

async function writeRecord(
  shop: string,
  record: TokenFailureRecord,
): Promise<void> {
  const value = JSON.stringify(record);

  await db.syncCursor.upsert({
    where: { shop_key: { shop, key: TOKEN_FAILURE_KEY } },
    update: { value },
    create: { shop, key: TOKEN_FAILURE_KEY, value },
  });
}

/**
 * Record one token-class failure. Returns the strike count now standing and
 * whether this call deactivated the shop.
 *
 * `now` is injectable so the unit tests can place failures in explicit windows
 * without a fake clock (Prisma keeps its own timers and must not see one).
 */
export async function recordTokenFailure(
  shop: string,
  reason: TokenFailureReason,
  now: Date = new Date(),
): Promise<{ count: number; deactivated: boolean }> {
  // Any evidence of a bad token re-arms the next success's DELETE.
  healthyShops.delete(shop);

  const row = await db.syncCursor.findUnique({
    where: { shop_key: { shop, key: TOKEN_FAILURE_KEY } },
  });
  const prior = parseRecord(row?.value);

  const anchor = prior.lastAt ? Date.parse(prior.lastAt) : NaN;
  if (!Number.isNaN(anchor) && now.getTime() - anchor < TOKEN_FAILURE_WINDOW_MS) {
    // Inside the current strike's window: this is the same sweep cycle. Record
    // the latest reason, but never move the count or the anchor.
    await writeRecord(shop, {
      count: prior.count,
      lastAt: prior.lastAt,
      lastReason: reason,
    });
    return { count: prior.count, deactivated: false };
  }

  const count = prior.count + 1;

  if (count >= TOKEN_FAILURE_THRESHOLD) {
    await deactivateShop(shop);
    // The dead sessions go now, so a later shop/redact has nothing to refresh.
    await db.session.deleteMany({ where: { shop } });
    await db.syncCursor.deleteMany({ where: { shop, key: TOKEN_FAILURE_KEY } });

    const line =
      `Deactivated ${shop} after ${count} unrefreshable-token strikes in ` +
      `separate sweep cycles (last: ${reason}) — treating the revoked token ` +
      `as an uninstall (WINDOWS #30)`;
    console.log(line);
    // Railway keeps logs for the CURRENT deployment only, so a deactivation
    // that happened before the next deploy would otherwise be unobservable
    // after the fact — and this one decides whether a paying merchant is still
    // being swept (threat T-Q30-07).
    Sentry.captureMessage(line, {
      level: "warning",
      tags: { windows: "30", shop },
    });

    return { count, deactivated: true };
  }

  await writeRecord(shop, {
    count,
    lastAt: now.toISOString(),
    lastReason: reason,
  });

  return { count, deactivated: false };
}

/**
 * One successful Admin call clears the evidence. A no-op once the shop is in
 * the process-level healthy set — see the DELETE BUDGET note in the header.
 */
export async function clearTokenFailures(shop: string): Promise<void> {
  if (healthyShops.has(shop)) return;

  await db.syncCursor.deleteMany({ where: { shop, key: TOKEN_FAILURE_KEY } });
  // Added only after the DELETE lands, so a throw is retried on the next
  // success rather than swallowed forever.
  healthyShops.add(shop);
}
