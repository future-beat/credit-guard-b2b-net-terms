import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/react-router";

import db from "../db.server";
import type { PublishCompanyCreditMutation } from "../types/admin.generated";
import { graphqlJson } from "./ledger.server";

/**
 * credit_v1 metafield publisher — the SINGLE writer of the server↔Function
 * contract (CRED-03, CRED-04, D-02, D-04, D-05).
 *
 * THE CONTRACT (payload law — this header is contract-home #2; home #1 is the
 * shopify.app.toml definition block, home #3 is tests/metafield-contract.test.ts,
 * whose fixtures are the source Phase 4 Function fixtures are generated from):
 *
 *   namespace `$app` (reserved shorthand — NEVER the app--{id} long form),
 *   key `credit_v1`, type `json`, owner = Company (Company.companyGid).
 *
 *   | field         | type                    | meaning                        |
 *   |---------------|-------------------------|--------------------------------|
 *   | v             | 1 (JSON number)         | payload schema version         |
 *   | limit         | decimal string OR null  | null = observe-only (D-02);    |
 *   |               |                         | "0.00" = block-all — the two   |
 *   |               |                         | are byte-distinct on purpose   |
 *   | exposure      | decimal string          | recomputeCompany output,       |
 *   |               |                         | verbatim (D-05)                |
 *   | currency      | string OR null          | rule 5 below                   |
 *   | overdue       | boolean                 | Company.overdue                |
 *   | bypass        | boolean                 | Company.bypassEnforcement —    |
 *   |               |                         | the reader's FIRST check; true |
 *   |               |                         | overrides overdue AND          |
 *   |               |                         | over-limit (D-03). See rule 10 |
 *   | data_complete | boolean                 | rule 4 below (SHOP-scoped)     |
 *   | computed_at   | ISO-8601 UTC string     | recomputedAt of the state      |
 *   |               |                         | being published                |
 *
 * Rules every reader and every future editor must hold:
 *
 * 1. MONEY IS DECIMAL STRINGS, NEVER JSON NUMBERS (research Pitfall 6). Floats
 *    corrupt cents in the Function's JS runtime; a $0.01 phantom over-limit
 *    would block a checkout — the exact catastrophe this app exists to
 *    prevent, inverted. Serialization is `Prisma.Decimal.toFixed(2)`
 *    (ROUND_HALF_UP if a 4dp ledger value ever occurs — L-03's rounding law;
 *    store-currency amounts are 2dp by construction so no rounding occurs in
 *    practice).
 * 2. `limit: null` ≠ `"0.00"` (D-02). JSON null means the merchant never set a
 *    limit — observe-only, the CRED-04 default. String zero means block-all.
 * 3. VERSIONING: readers ignore unknown fields (additive evolution); a
 *    breaking change (field removal/rename/retype) ships as a NEW key
 *    `credit_v2` written alongside `credit_v1`, never an in-place change
 *    (D-04 one-way door — deployed Functions parse this payload on live
 *    merchant checkouts once Phase 4 ships).
 * 4. `data_complete` IS SHOP-SCOPED (L-01): false iff ANY LedgerOrder in the
 *    shop is UNRESOLVED with hasPaymentTerms=true, applied to every company's
 *    payload. UNRESOLVED rows carry companyId null by construction, so an
 *    unattributed net-terms order could belong to any company. NO_COMPANY
 *    (proven none) and card-paid D2C UNRESOLVED rows never flag it.
 * 5. `currency` (L-04): currencyCode of the company's own ledger rows; else
 *    the shop's most recent LedgerOrder; else JSON null — which can only
 *    co-occur with exposure "0.00" (all amounts are store currency, D-07).
 * 6. THE PUBLISHER NEVER COMPUTES exposure/overdue/earliestDueAt — it projects
 *    what `recomputeCompany` (ledger.server.ts rule 3, the sole writer)
 *    already persisted (D-05).
 * 7. NO PII EVER ENTERS THE PAYLOAD (T-03-07) — company money/state fields
 *    only; the payload is merchant-visible via the definition's merchant_read
 *    access. tests/metafield-contract.test.ts locks the exact key set.
 * 8. `publishCompanyCreditState` NEVER THROWS to its caller (T-03-09): a
 *    metafield API blip must not 500 a webhook whose ledger work already
 *    committed — that would trigger a redelivery the receipt dedupes, and the
 *    publish would never retry. Failure = Sentry + the dirty marker
 *    `publishedAt < recomputedAt`; the hourly sweep (03-04) is the retry.
 * 9. EVERY read and write here is keyed by shop (T-03-06): the Company row is
 *    selected by { id, shop }, the transport session is the shop's own
 *    offline session, and ownerId comes only from that shop-scoped row — one
 *    shop's state can never land on another shop's Company.
 * 10. BYPASS PRECEDENCE IS PART OF THE CONTRACT, NOT AN IMPLEMENTATION
 *    DETAIL (D-03; restated here per 03-VERIFICATION item 5). Every reader of
 *    this payload — the validation Function, the dashboard, any future
 *    consumer — MUST evaluate `bypass` FIRST and, when it is true, allow the
 *    checkout without consulting `overdue`, `limit` or `exposure`. Bypass
 *    overrides BOTH the overdue rule and the over-limit rule; it is not a
 *    tie-breaker between them. The server-side mirrors of this decision
 *    (`isBlockedState` / `wouldBlockOrder` in enforcement.server.ts) short-
 *    circuit on bypass for exactly this reason, so a reader that checked
 *    `overdue` first would disagree with the app's own event log about
 *    whether a company was ever blocked. This rule is a RESTATEMENT of
 *    already-shipped behaviour: the payload's fields, their order and their
 *    serialization are untouched, so the contract hash and every fixture in
 *    tests/metafield-contract.test.ts are byte-identical (payload law rule 3
 *    — additive only).
 */

/* ------------------------------------------------------------------ *
 * The one Admin GraphQL document this module executes.
 * ------------------------------------------------------------------ */

/**
 * metafieldsSet, byte-per the 2026-07 schema (verified in 03-RESEARCH.md
 * §Write Path). `compareDigest` is deliberately absent: this app is the sole
 * writer of its `$app` namespace by platform rule, and publishes are
 * serialized per company through the recomputeCompany call sites.
 */
export const PUBLISH_COMPANY_CREDIT_MUTATION = `#graphql
  mutation PublishCompanyCredit($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace updatedAt }
      userErrors { field message code elementIndex }
    }
  }
`;

/**
 * The transport returns the whole response body; `data` carries the
 * codegen-generated mutation payload (the Phase 2 typo-trap defense — every
 * selected field is validated against admin-2026-07.schema.json).
 */
interface PublishCompanyCreditResponse {
  data?: PublishCompanyCreditMutation | null;
}

/**
 * `metafieldsSet` failures arrive as `userErrors` INSIDE `data` with a 200 and
 * an EMPTY top-level errors[] — the transport does not throw on them (research
 * Pitfall 1). This error is thrown internally when userErrors are present and
 * is always caught by the non-throwing wrapper (rule 8), landing in Sentry.
 */
export class MetafieldPublishError extends Error {
  readonly userErrors: unknown[];

  constructor(shop: string, userErrors: unknown[]) {
    super(
      `PublishCompanyCredit userErrors for ${shop}: ${JSON.stringify(userErrors)}`,
    );
    this.name = "MetafieldPublishError";
    this.userErrors = userErrors;
  }
}

/* ------------------------------------------------------------------ *
 * Serialization — the contract's canonical byte shape.
 * ------------------------------------------------------------------ */

export interface CreditStateFields {
  limit: Prisma.Decimal | null;
  exposure: Prisma.Decimal;
  currency: string | null;
  overdue: boolean;
  bypass: boolean;
  dataComplete: boolean;
}

/**
 * Canonical serialization: key order v, limit, exposure, currency, overdue,
 * bypass, data_complete, computed_at — stable forever (rule 3). Money via
 * `Decimal.toFixed(2)` (rules 1–2).
 */
export function serializeCreditState(
  input: CreditStateFields & { computedAt: Date },
): string {
  return JSON.stringify({
    v: 1,
    limit: input.limit === null ? null : input.limit.toFixed(2),
    exposure: input.exposure.toFixed(2),
    currency: input.currency,
    overdue: input.overdue,
    bypass: input.bypass,
    data_complete: input.dataComplete,
    computed_at: input.computedAt.toISOString(),
  });
}

/**
 * sha256 hex over the canonical serialization WITHOUT computed_at: the same
 * state computed at two instants hashes identically, which is what lets the
 * hourly sweep skip no-op writes (hash-skip) while `computed_at` still exposes
 * staleness to readers.
 */
export function creditStateHash(input: CreditStateFields): string {
  const canonical = JSON.stringify({
    v: 1,
    limit: input.limit === null ? null : input.limit.toFixed(2),
    exposure: input.exposure.toFixed(2),
    currency: input.currency,
    overdue: input.overdue,
    bypass: input.bypass,
    data_complete: input.dataComplete,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/* ------------------------------------------------------------------ *
 * Shop-scoped payload inputs.
 * ------------------------------------------------------------------ */

/**
 * L-01 NOT-EXISTS: the shop's ledger is complete unless any net-terms order is
 * still unattributed (rule 4). NO_COMPANY rows and card-paid D2C UNRESOLVED
 * rows never flag it.
 */
export async function shopDataComplete(shop: string): Promise<boolean> {
  const unresolvedNetTerms = await db.ledgerOrder.findFirst({
    where: { shop, attributionStatus: "UNRESOLVED", hasPaymentTerms: true },
    select: { id: true },
  });
  return unresolvedNetTerms === null;
}

/** L-04 currency source (rule 5). */
async function resolveCurrency(
  shop: string,
  companyId: string,
): Promise<string | null> {
  const own = await db.ledgerOrder.findFirst({
    where: { shop, companyId },
    orderBy: { refetchedAt: "desc" },
    select: { currencyCode: true },
  });
  if (own) return own.currencyCode;

  const mostRecent = await db.ledgerOrder.findFirst({
    where: { shop },
    orderBy: { refetchedAt: "desc" },
    select: { currencyCode: true },
  });
  return mostRecent?.currencyCode ?? null;
}

/* ------------------------------------------------------------------ *
 * The publisher.
 * ------------------------------------------------------------------ */

/**
 * Publish one company's credit state to its `$app`/`credit_v1` metafield.
 *
 * NON-THROWING (rule 8). Reads the Company row fresh — a projection of
 * whatever `recomputeCompany` last committed (rule 6) — gates on Shop.active
 * (the SCHEDULER CONTRACT in shop-lifecycle.server.ts extends to metafield
 * publishing by name), hash-skips genuine no-ops, and advances
 * publishedStateHash/publishedAt only after a userErrors-free write.
 *
 * Skip rule: hash equal AND publishedAt >= recomputedAt → no API call.
 * Hash equal but publishedAt < recomputedAt → publish anyway: that is the
 * failed-write retry channel. recomputedAt null (a never-recomputed row
 * enumerated by the sweep backstop) → PUBLISH — fail toward freshness; the
 * observe-only default state is harmless to publish, and skipping could
 * strand a company invisible to Phase 4.
 */
export async function publishCompanyCreditState(
  shop: string,
  companyId: string,
): Promise<void> {
  try {
    const shopRow = await db.shop.findUnique({
      where: { domain: shop },
      select: { active: true },
    });
    if (!shopRow?.active) return;

    // Shop in the WHERE (rule 9): a cross-shop id matches zero rows.
    const company = await db.company.findFirst({
      where: { id: companyId, shop },
    });
    if (!company) return;

    const fields: CreditStateFields = {
      limit: company.creditLimit,
      exposure: company.exposure,
      currency: await resolveCurrency(shop, company.id),
      overdue: company.overdue,
      bypass: company.bypassEnforcement,
      dataComplete: await shopDataComplete(shop),
    };
    const hash = creditStateHash(fields);

    if (
      hash === company.publishedStateHash &&
      company.publishedAt !== null &&
      company.recomputedAt !== null &&
      company.publishedAt.getTime() >= company.recomputedAt.getTime()
    ) {
      return;
    }

    // computed_at is the recomputedAt of the state being published; a
    // never-recomputed row (default state) stamps the publish instant instead.
    const value = serializeCreditState({
      ...fields,
      computedAt: company.recomputedAt ?? new Date(),
    });

    const body = await graphqlJson<PublishCompanyCreditResponse>(
      shop,
      PUBLISH_COMPANY_CREDIT_MUTATION,
      {
        variables: {
          metafields: [
            {
              ownerId: company.companyGid,
              namespace: "$app",
              key: "credit_v1",
              type: "json",
              value,
            },
          ],
        },
        label: "PublishCompanyCredit",
      },
    );

    // THE TRAP (research Pitfall 1): userErrors arrive inside `data` with a
    // 200 and empty top-level errors[] — the transport will NOT throw on them.
    const userErrors = body.data?.metafieldsSet?.userErrors ?? [];
    if (userErrors.length > 0) {
      throw new MetafieldPublishError(shop, userErrors);
    }

    // Success bookkeeping ONLY — these two columns are this module's entire
    // write surface on Company (rule 6).
    await db.company.update({
      where: { id: company.id },
      data: { publishedStateHash: hash, publishedAt: new Date() },
    });
  } catch (error) {
    // Rule 8: never rethrow into a webhook/sweep caller. The dirty marker
    // publishedAt < recomputedAt is the retry state the 03-04 sweep scans.
    Sentry.captureException(error, {
      tags: { publisher: "credit_v1", shop },
    });
  }
}
