import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/react-router";

import db from "../db.server";
import { graphqlJson } from "./ledger.server";
import {
  MAX_MESSAGE_LENGTH,
  validateMessage,
  type MessageRejection,
  type MessageValidation,
  type ValidationMessages,
} from "../block-messages";

/**
 * The pure block-message contract lives in `app/block-messages.ts` so the
 * Settings page can import the cap and the validator into browser code without
 * dragging Prisma and the Admin client along (see that file's header). It is
 * re-exported here because this module is the canonical enforcement surface —
 * every existing caller keeps its import path.
 */
export {
  MAX_MESSAGE_LENGTH,
  validateMessage,
  type MessageRejection,
  type MessageValidation,
  type ValidationMessages,
};

/**
 * Enforcement observability service (ENFC-05 as re-scoped by D4-03, ENFC-06).
 *
 * Two pure predicates and one best-effort writer. Three rules hold for every
 * function here and every future caller:
 *
 * 1. THE LOG IS AN OBSERVER, NEVER AN INPUT. Nothing in this file is ever read
 *    back by `recomputeCompany`, `publishCompanyCreditState`, or the validation
 *    Function. The credit_v1 metafield remains the single server↔Function
 *    contract; these rows exist so a merchant can SEE what enforcement did.
 *    That one-way direction is what makes rule 2 safe.
 * 2. AN EVENT WRITE NEVER THROWS TO ITS CALLER. Every call site here sits
 *    downstream of committed ledger or settings work (a webhook that already
 *    wrote balances, a settings action that already saved a limit). A throw
 *    would turn a bookkeeping blip into a 500, a redelivery the receipt dedupes
 *    away, and a lost webhook — the publisher's rule-8 posture, for the same
 *    reason (threat T-04-07).
 * 3. MONEY IS `Prisma.Decimal`, NEVER A NUMBER. Both predicates decide whether
 *    a merchant's customer can buy; `Number(exposure) >= Number(limit)` would
 *    put a float rounding artifact between a paying customer and a checkout
 *    (payload law rule 1).
 */

/**
 * The event vocabulary (P4-L3). Stored as strings and validated by code, the
 * same discipline as `LedgerOrder.attributionStatus` — a Postgres enum would
 * make every future kind a migration.
 */
export const EVENT_KIND = {
  /** A company crossed INTO blocked state (P4-L1). Written by recomputeCompany. */
  BLOCK_STATE_ENTERED: "BLOCK_STATE_ENTERED",
  /** A company crossed OUT of blocked state. Written by recomputeCompany. */
  BLOCK_STATE_EXITED: "BLOCK_STATE_EXITED",
  /** The merchant turned the per-company bypass ON (CRED-02). */
  BYPASS_ENABLED: "BYPASS_ENABLED",
  /** The merchant turned the per-company bypass OFF. */
  BYPASS_DISABLED: "BYPASS_DISABLED",
  /** A net-terms order the Function would have stopped got through (ENFC-06). */
  BYPASSED_ORDER: "BYPASSED_ORDER",
} as const;

export type EnforcementEventKind =
  (typeof EVENT_KIND)[keyof typeof EVENT_KIND];

/** Anything `new Prisma.Decimal(...)` accepts — Company columns included. */
type DecimalLike = Prisma.Decimal | string | number;

/**
 * The four Company columns both predicates reason about. A `Company` row
 * satisfies this shape directly, and so does a plain test fixture.
 */
export interface CreditStateInput {
  bypassEnforcement: boolean;
  creditLimit: DecimalLike | null;
  exposure: DecimalLike;
  overdue: boolean;
}

/**
 * Is this company in BLOCKED STATE right now? (P4-L1)
 *
 *   bypass false AND limit non-null AND (overdue OR exposure >= limit)
 *
 * THREE COMPARISONS LIVE IN THIS CODEBASE AND ALL THREE ARE DIFFERENT ON
 * PURPOSE. Anyone "fixing" one to match another breaks a merchant promise:
 *
 *   1. The Companies page badge (app.companies.tsx) reads OVER LIMIT at
 *      `exposure > limit` — strictly over. It answers "has this company
 *      borrowed more than you allowed?", and at exactly the limit the honest
 *      answer is no: they used exactly what you gave them.
 *   2. The validation Function (D4-01, remaining-credit semantics) blocks a
 *      cart at `exposure + cart_total > limit` — strictly over, INCLUDING the
 *      cart. At-limit-exactly is allowed, matching Phase 3's
 *      at-limit-is-within boundary. That is the per-checkout decision.
 *   3. THIS predicate uses `exposure >= limit` — at-or-over. It answers a
 *      third question: "can this company place ANY new net-terms order?"
 *      Under (2), a company at exactly its limit has zero remaining credit, so
 *      EVERY cart with a positive total fails `exposure + cart > limit`. Zero
 *      remaining credit therefore IS the order-blocking state, even though the
 *      badge still reads "Within limit".
 *
 * So a company sitting exactly at its limit shows "Within limit" on the page
 * and still produces a BLOCK_STATE_ENTERED event — deliberate, because the
 * badge reports borrowing and this reports blocking.
 *
 * Bypass is checked FIRST (D-03): it overrides overdue AND over-limit, exactly
 * as the Function reads credit_v1. Observe-only (limit null) is never blocked
 * state whatever the ledger says — enforcement is armed per company by setting
 * a limit (CRED-04).
 */
export function isBlockedState(state: CreditStateInput): boolean {
  if (state.bypassEnforcement) return false;
  if (state.creditLimit === null || state.creditLimit === undefined) {
    return false;
  }
  if (state.overdue) return true;

  const exposure = new Prisma.Decimal(state.exposure);
  const limit = new Prisma.Decimal(state.creditLimit);
  return exposure.gte(limit);
}

export interface OrderBlockInput extends CreditStateInput {
  /** The order's own outstanding balance — the cart-total proxy (P4-L2). */
  orderOutstanding: DecimalLike;
}

/**
 * Would the validation Function have stopped THIS order? (P4-L2)
 *
 *   bypass false AND limit non-null AND
 *   (overdue OR exposure_pre + order_outstanding > limit)
 *
 * This is the D4-01 comparison verbatim, evaluated server-side after the fact:
 * `exposure` must be the company's exposure BEFORE this order contributed, and
 * `orderOutstanding` stands in for the cart total. That proxy is exact for an
 * unpaid net-terms order; an order already part-paid when it lands understates
 * the cart, which can only UNDER-flag — the same conservative direction the
 * rest of the ledger leans (D-01).
 *
 * Currency is uniform store currency server-side (D-07), so the D4-02
 * mismatch arm has no counterpart here.
 *
 * VERIFIER NOTE (F-06): this predicate is deliberately BROADER than
 * REQUIREMENTS.md ENFC-05's literal "while its company was blocked" wording.
 * It also flags an order that would itself have exceeded remaining credit even
 * though the company was not yet in blocked state — because that is exactly
 * the comparison the Function would have made at that checkout. Extra
 * BYPASSED_ORDER rows beyond the literal wording are intentional coverage, NOT
 * false positives; the Phase 4 PR (04-05) carries the matching one-line
 * REQUIREMENTS.md touch-up.
 */
export function wouldBlockOrder(input: OrderBlockInput): boolean {
  if (input.bypassEnforcement) return false;
  if (input.creditLimit === null || input.creditLimit === undefined) {
    return false;
  }
  if (input.overdue) return true;

  const limit = new Prisma.Decimal(input.creditLimit);
  const projected = new Prisma.Decimal(input.exposure).plus(
    new Prisma.Decimal(input.orderOutstanding),
  );
  // Strictly greater: landing exactly on the limit is allowed (D4-01).
  return projected.gt(limit);
}

/** One row's worth of observation. `shop` is passed separately, always. */
export interface EnforcementEventInput {
  companyGid: string;
  companyName: string;
  kind: EnforcementEventKind;
  /** BYPASSED_ORDER only. */
  orderGid?: string | null;
  /** BYPASSED_ORDER only — the order's outstanding balance (store currency). */
  amount?: DecimalLike | null;
  /** BYPASSED_ORDER only — `Order.sourceName`. */
  channel?: string | null;
  exposure: DecimalLike;
  limit?: DecimalLike | null;
  overdue: boolean;
  bypass: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Append one observation. NEVER THROWS (rule 2).
 *
 * A duplicate-key rejection is a SUCCESS, not a failure: the unique index
 * `[shop, kind, orderGid]` is the ENFC-06 dedupe, so a webhook redelivery, a
 * coalesced doorbell or a reconciliation refetch racing the original write all
 * land here and are absorbed silently. Sending those to Sentry would train the
 * merchant's alerting to ignore this module.
 *
 * Anything else — the event store being down, a schema drift — is captured and
 * swallowed. The caller's ledger or settings work has already committed and
 * must stand.
 *
 * Every write is keyed by the caller's `shop` (T-03-06): this module has no
 * shop enumerator and never derives a tenant from anything but its argument.
 */
export async function recordEnforcementEvent(
  shop: string,
  event: EnforcementEventInput,
): Promise<void> {
  try {
    await db.enforcementEvent.create({
      data: {
        shop,
        companyGid: event.companyGid,
        companyName: event.companyName,
        kind: event.kind,
        orderGid: event.orderGid ?? null,
        amount:
          event.amount === null || event.amount === undefined
            ? null
            : new Prisma.Decimal(event.amount),
        channel: event.channel ?? null,
        exposure: new Prisma.Decimal(event.exposure),
        limit:
          event.limit === null || event.limit === undefined
            ? null
            : new Prisma.Decimal(event.limit),
        overdue: event.overdue,
        bypass: event.bypass,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return;

    Sentry.captureException(error, {
      tags: { enforcementEvent: event.kind, shop },
    });
  }
}

/* ------------------------------------------------------------------ *
 * App-managed Validation registration (ENFC-01/02/03/04)
 * ------------------------------------------------------------------ */

/**
 * THE REGISTRATION ENSURE-STEP.
 *
 * A deployed Function does nothing. What makes it run on a merchant's checkout
 * is a Validation object binding the function handle to the shop — created
 * either by the merchant (Settings → Checkout → Checkout rules → Add rule) or,
 * as here, by the app through `validationCreate` (04-RESEARCH Q6). App-managed
 * is the deliberate choice: zero-setup onboarding, and it is the ONLY way the
 * app controls `blockOnFailure` rather than inheriting whatever a hand-made
 * rule defaults to.
 *
 * Three rules hold for everything below:
 *
 * 1. `blockOnFailure` IS FALSE, ALWAYS, EXPLICITLY. Shopify: "Validation errors
 *    always block checkout progress. The `blockOnFailure` field controls
 *    whether runtime exceptions, such as timeouts, also block checkout." True
 *    means a crash or a slow function in OUR code stops a real sale — this
 *    app's purpose inverted (threat T-04-09). The literal is written in the
 *    create variables (never omitted-to-default) and asserted by a test.
 * 2. IDEMPOTENT BY PLATFORM STATE, NOT BY OUR BOOKKEEPING. Every call re-reads
 *    `validations(first: 50)` and matches OUR function client-side —
 *    `Query.validations` has no functionHandle filter (research Q6). The stored
 *    GID is a cache for the dashboard, never the skip condition: a merchant who
 *    deletes the rule must get it back on the next app-open, and a stale GID
 *    must not suppress a needed create.
 * 3. NEVER THROWS. This runs fire-and-forget from the app shell loader, and the
 *    expected state between a scope release and the merchant accepting the
 *    re-consent prompt is ACCESS_DENIED. A throw there would turn a normal
 *    permissions handshake into a broken admin page.
 */

/** The extension handle in extensions/credit-guard-validation/*.toml. */
export const VALIDATION_FUNCTION_HANDLE = "credit-guard-validation";

/** What the merchant sees in Settings → Checkout → Checkout rules. */
export const VALIDATION_TITLE = "Credit Guard: net-terms credit check";

/** P4-L5. `$app` is the reserved shorthand — never the app--{id} long form. */
export const CONFIG_METAFIELD_NAMESPACE = "$app";
export const CONFIG_METAFIELD_KEY = "config_v1";

/**
 * Block copy shipped at registration (P4-L4) — THE canonical home.
 *
 * The Function duplicates these strings because wasm cannot import server code
 * (see the 04-01 header); tests/enforcement-registration.test.ts diffs the two
 * mechanically so the duplication can never drift silently. 04-04's
 * merchant-editable settings default to exactly these.
 */
export const DEFAULT_MESSAGES = {
  overLimit:
    "Your company has reached its credit limit with us. To place this order, please contact us or settle open invoices to free up available credit.",
  overdue:
    "Your account has overdue invoices. New orders on payment terms are paused until the balance is settled — please contact us to arrange payment.",
} as const;

/**
 * The config_v1 payload (P4-L5): `{"v":1,"over_limit_message":…,
 * "overdue_message":…}`. Same versioning law as credit_v1 — additive evolution
 * only; a breaking change ships as config_v2 alongside, never a rename or an
 * in-place retype, because deployed Functions parse this on live checkouts.
 */
export function buildConfigValue(
  messages: ValidationMessages = DEFAULT_MESSAGES,
): string {
  return JSON.stringify({
    v: 1,
    over_limit_message: messages.overLimit,
    overdue_message: messages.overdue,
  });
}

/**
 * Every validation on the shop, ours and other apps'. `first: 50` is the whole
 * population in practice — checkout rules are a handful per store — and there
 * is no server-side filter to narrow it (research Q6).
 */
export const ENSURE_VALIDATION_QUERY = `#graphql
  query EnsureValidationState {
    validations(first: 50) {
      nodes {
        id
        enabled
        blockOnFailure
        shopifyFunction { handle appKey }
      }
    }
  }
`;

/** Variables only — no interpolation anywhere near a GraphQL document. */
export const CREATE_VALIDATION_MUTATION = `#graphql
  mutation EnsureValidation($validation: ValidationCreateInput!) {
    validationCreate(validation: $validation) {
      validation {
        id
        enabled
        blockOnFailure
        shopifyFunction { handle }
      }
      userErrors { field message code }
    }
  }
`;

/** A3 fallback only: config written as a second step, owned by the Validation. */
export const SET_VALIDATION_CONFIG_MUTATION = `#graphql
  mutation SetValidationConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id key namespace }
      userErrors { field message code }
    }
  }
`;

interface ValidationUserError {
  field?: string[] | null;
  message?: string | null;
  code?: string | null;
}

interface ValidationNode {
  id: string;
  enabled?: boolean | null;
  blockOnFailure?: boolean | null;
  shopifyFunction?: { handle?: string | null; appKey?: string | null } | null;
}

interface ValidationsQueryResponse {
  data?: { validations?: { nodes?: ValidationNode[] | null } | null } | null;
}

interface ValidationCreateResponse {
  data?: {
    validationCreate?: {
      validation?: ValidationNode | null;
      userErrors?: ValidationUserError[] | null;
    } | null;
  } | null;
}

interface MetafieldsSetResponse {
  data?: {
    metafieldsSet?: { userErrors?: ValidationUserError[] | null } | null;
  } | null;
}

/**
 * userErrors arrive INSIDE `data` with a 200 and an empty top-level errors[] —
 * the transport will NOT throw on them (research Pitfall 1, metafields rule 8).
 * Treating them as success is how an app ends up believing it registered a rule
 * that does not exist.
 */
class ValidationRegistrationError extends Error {
  readonly userErrors: ValidationUserError[];

  constructor(shop: string, stage: string, userErrors: ValidationUserError[]) {
    super(
      `${stage} userErrors for ${shop}: ${JSON.stringify(userErrors)}`,
    );
    this.name = "ValidationRegistrationError";
    this.userErrors = userErrors;
  }
}

/**
 * Does this userError blame the inline `metafields` input (A3)?
 *
 * `ValidationCreateInput.metafields` is schema-verified, but whether it accepts
 * the `$app` namespace with type json inline was only deploy-time-verifiable
 * (04-RESEARCH A3). If it is rejected, the documented fallback is a bare create
 * followed by metafieldsSet on the new Validation — so the rule still ships
 * fail-open and live, and only the merchant-editable copy takes a second hop.
 */
function looksLikeMetafieldRejection(errors: ValidationUserError[]): boolean {
  return errors.some((error) => {
    const field = (error.field ?? []).join(".").toLowerCase();
    const message = (error.message ?? "").toLowerCase();
    return (
      field.includes("metafield") ||
      message.includes("metafield") ||
      message.includes("namespace")
    );
  });
}

/** ACCESS_DENIED is the EXPECTED pre-consent state, not an incident. */
function isAccessDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("ACCESS_DENIED") ||
    message.includes("write_validations") ||
    message.includes("Access denied")
  );
}

async function storeValidationGid(shop: string, gid: string): Promise<void> {
  // Shop in the WHERE: a domain is the tenant key everywhere in this codebase.
  await db.shop.update({ where: { domain: shop }, data: { validationGid: gid } });
}

function createVariables(withMetafields: boolean) {
  const validation: Record<string, unknown> = {
    functionHandle: VALIDATION_FUNCTION_HANDLE,
    title: VALIDATION_TITLE,
    // "Live on the merchant checkout" (ValidationCreateInput.enable).
    enable: true,
    // RULE 1. Literal, explicit, never omitted. See the header.
    blockOnFailure: false,
  };

  if (withMetafields) {
    validation.metafields = [
      {
        namespace: CONFIG_METAFIELD_NAMESPACE,
        key: CONFIG_METAFIELD_KEY,
        type: "json",
        value: buildConfigValue(),
      },
    ];
  }

  return { validation };
}

/**
 * Ensure this shop has our Validation, creating it exactly once. NEVER THROWS.
 *
 * Called fire-and-forget from the embedded app shell loader on every
 * authenticated load, the same way `startBackfill` is: the merchant accepting
 * the permissions prompt IS an app-open, so the first load after re-consent is
 * the moment enforcement arms itself with no merchant action at all.
 *
 * A merchant who has turned the rule OFF in checkout settings keeps it off —
 * the ensure-step records the state and never issues validationUpdate to
 * override it (research Open Question 1). Off is a choice, not drift.
 *
 * Concurrency (T-04-12, accepted for v1): two simultaneous app-opens can both
 * observe "absent" and both create. The next pass matches by handle and stops,
 * a duplicate rule is visible and removable in checkout settings, and both
 * copies are fail-open — so the blast radius is cosmetic.
 */
export async function ensureValidationRegistered(shop: string): Promise<void> {
  try {
    // Active gate FIRST, before any transport: an uninstalled shop has no
    // usable session, and asking anyway is how a background path turns an
    // uninstall into recurring Sentry noise (scheduler contract posture).
    const shopRow = await db.shop.findUnique({
      where: { domain: shop },
      select: { active: true },
    });
    if (!shopRow?.active) return;

    const state = await graphqlJson<ValidationsQueryResponse>(
      shop,
      ENSURE_VALIDATION_QUERY,
      { label: "EnsureValidationState" },
    );

    // eslint-disable-next-line no-undef
    const appKey = process.env.SHOPIFY_API_KEY;
    const nodes = state.data?.validations?.nodes ?? [];
    const existing = nodes.find((node) => {
      const fn = node.shopifyFunction;
      if (!fn || fn.handle !== VALIDATION_FUNCTION_HANDLE) return false;
      // appKey is the belt on the handle's braces: another app cannot ship our
      // handle, but a node that names a DIFFERENT app key definitively is not
      // ours. An absent appKey (or an unset env in tests) falls back to the
      // handle match rather than pretending to know.
      return !appKey || !fn.appKey || fn.appKey === appKey;
    });

    if (existing) {
      // Refresh unconditionally: the platform is the source of truth and a
      // stale stored GID would point the dashboard at a deleted object.
      await storeValidationGid(shop, existing.id);
      return;
    }

    let created: ValidationNode | null = null;
    let configWrittenInline = true;

    const firstAttempt = await graphqlJson<ValidationCreateResponse>(
      shop,
      CREATE_VALIDATION_MUTATION,
      { variables: createVariables(true), label: "EnsureValidation" },
    );
    const firstErrors = firstAttempt.data?.validationCreate?.userErrors ?? [];

    if (firstErrors.length === 0) {
      created = firstAttempt.data?.validationCreate?.validation ?? null;
    } else if (looksLikeMetafieldRejection(firstErrors)) {
      // A3 fallback. Recorded, not silent: which path won is evidence the next
      // reader (and the plan SUMMARY) needs about a deploy-time-only question.
      Sentry.captureMessage(
        "ValidationCreate rejected the inline config_v1 metafield — using the A3 fallback (bare create + metafieldsSet)",
        { level: "info", tags: { shop }, extra: { userErrors: firstErrors } },
      );
      configWrittenInline = false;

      const retry = await graphqlJson<ValidationCreateResponse>(
        shop,
        CREATE_VALIDATION_MUTATION,
        { variables: createVariables(false), label: "EnsureValidation" },
      );
      const retryErrors = retry.data?.validationCreate?.userErrors ?? [];
      if (retryErrors.length > 0) {
        throw new ValidationRegistrationError(shop, "EnsureValidation", retryErrors);
      }
      created = retry.data?.validationCreate?.validation ?? null;
    } else {
      throw new ValidationRegistrationError(shop, "EnsureValidation", firstErrors);
    }

    if (!created?.id) {
      throw new Error(
        `EnsureValidation returned no validation for ${shop} and no userErrors`,
      );
    }

    // The rule exists and is fail-open-configured: bank the GID BEFORE the
    // optional config hop. If that hop fails, the Function still blocks with
    // its own DEFAULT_MESSAGES (ENFC-03) — losing the GID here would instead
    // strand a live rule the dashboard cannot see.
    await storeValidationGid(shop, created.id);

    if (!configWrittenInline) {
      const config = await graphqlJson<MetafieldsSetResponse>(
        shop,
        SET_VALIDATION_CONFIG_MUTATION,
        {
          variables: {
            metafields: [
              {
                ownerId: created.id,
                namespace: CONFIG_METAFIELD_NAMESPACE,
                key: CONFIG_METAFIELD_KEY,
                type: "json",
                value: buildConfigValue(),
              },
            ],
          },
          label: "SetValidationConfig",
        },
      );
      const configErrors = config.data?.metafieldsSet?.userErrors ?? [];
      if (configErrors.length > 0) {
        throw new ValidationRegistrationError(
          shop,
          "SetValidationConfig",
          configErrors,
        );
      }
    }
  } catch (error) {
    // RULE 3. Non-throwing, always. Pre-consent ACCESS_DENIED is a warning:
    // it is the normal state of a shop between a scope release and the
    // merchant accepting the prompt, and paging on it would train the alerting
    // to ignore this module.
    Sentry.captureException(error, {
      level: isAccessDenied(error) ? "warning" : "error",
      tags: { registration: "checkout-validation", shop },
    });
  }
}

/* ------------------------------------------------------------------ *
 * Merchant-editable block copy (ENFC-03) — the settings page's service half
 * ------------------------------------------------------------------ */

/**
 * config_v1 value string -> the two messages, falling back FIELD BY FIELD.
 *
 * A deliberate mirror of the Function's `messagesFrom` (same version gate, same
 * per-field fallback, same cap): the settings page must show the merchant
 * exactly the copy the checkout will use. An unparseable value, an unknown
 * version, or one junk field therefore shows the DEFAULT for that field — what
 * the Function would actually render — instead of a blank box inviting the
 * merchant to believe nothing is configured.
 */
export function parseConfigValue(raw: unknown): ValidationMessages {
  if (typeof raw !== "string") return { ...DEFAULT_MESSAGES };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_MESSAGES };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_MESSAGES };
  }

  const config = parsed as Record<string, unknown>;
  if (config.v !== 1) return { ...DEFAULT_MESSAGES };

  const overLimit = validateMessage(config.over_limit_message);
  const overdue = validateMessage(config.overdue_message);

  return {
    overLimit: overLimit.ok ? overLimit.value : DEFAULT_MESSAGES.overLimit,
    overdue: overdue.ok ? overdue.value : DEFAULT_MESSAGES.overdue,
  };
}

/**
 * The three HONEST states (research Pattern 2 — never paint green over a rule
 * that is not running):
 *
 *  - `active`       the Validation exists AND the merchant has it enabled.
 *  - `disabled`     it exists and the merchant turned it OFF in Settings ->
 *                   Checkout -> Checkout rules. That is a legitimate choice, so
 *                   the app reports it rather than overriding it (the
 *                   ensure-step's matching posture) — but it must never be
 *                   allowed to look like enforcement.
 *  - `unregistered` no Validation for this shop: pre-consent, mid-install, or
 *                   the merchant deleted the rule.
 *
 * All three come from PLATFORM state read back through the Admin API — never
 * inferred from our own `Shop.validationGid` alone, which is a cache that a
 * deleted rule makes stale.
 */
export type ValidationStatus = "active" | "disabled" | "unregistered";

export interface ValidationConfigState {
  status: ValidationStatus;
  messages: ValidationMessages;
}

/**
 * Read back OUR Validation: is it live, and what copy is on it?
 *
 * `blockOnFailure` is selected even though the settings page never shows it,
 * because `updateValidationMessages` must ECHO both flags back — see the
 * mutation below for the live measurement that forced this.
 */
export const READ_VALIDATION_CONFIG_QUERY = `#graphql
  query ValidationConfig($id: ID!) {
    validation(id: $id) {
      id
      enabled
      blockOnFailure
      metafield(namespace: "$app", key: "config_v1") { value }
    }
  }
`;

/**
 * Variables only. `validationUpdate` takes the id OUTSIDE the input object
 * (byte-checked against admin-2026-07.schema.json: `validationUpdate(id: ID!,
 * validation: ValidationUpdateInput!)`), and `ValidationUpdateInput.metafields`
 * is `[MetafieldInput!]` — the same inline shape the create uses.
 *
 * `enable` AND `blockOnFailure` ARE in the input, carrying the values just read
 * off the live rule. THIS IS NOT OPTIONAL AND IT IS NOT DEFENSIVE PADDING.
 *
 * MEASURED ON credit-guard-demo, 2026-08-20 (plan 04-05): a `validationUpdate`
 * whose input carried ONLY `metafields` returned `userErrors: []` and set
 * `enabled` from true to FALSE. `validationUpdate` is not a partial update — an
 * omitted flag is re-defaulted, not left alone. Until this was found, every
 * merchant who edited their block copy silently turned their own checkout
 * enforcement off, and the settings page then reported `disabled` perfectly
 * honestly without anyone knowing the edit had caused it.
 *
 * Plan 04-04 omitted `enable` on purpose, to stop a copy edit re-enabling a
 * rule the merchant had switched off. That intent is right and is preserved
 * here — by ECHOING the observed flags, so an edit leaves the rule exactly as
 * it found it in either direction, stated rather than assumed.
 */
export const UPDATE_VALIDATION_MUTATION = `#graphql
  mutation UpdateValidationConfig($id: ID!, $validation: ValidationUpdateInput!) {
    validationUpdate(id: $id, validation: $validation) {
      validation { id enabled }
      userErrors { field message code }
    }
  }
`;

interface ValidationConfigResponse {
  data?: {
    validation?: {
      id?: string | null;
      enabled?: boolean | null;
      blockOnFailure?: boolean | null;
      metafield?: { value?: string | null } | null;
    } | null;
  } | null;
}

interface ValidationUpdateResponse {
  data?: {
    validationUpdate?: {
      validation?: { id?: string | null; enabled?: boolean | null } | null;
      userErrors?: ValidationUserError[] | null;
    } | null;
  } | null;
}

/** The shop's own cached GID, and only ever its own (T-04-14). */
async function readValidationGid(shop: string): Promise<string | null> {
  const row = await db.shop.findUnique({
    where: { domain: shop },
    select: { validationGid: true },
  });
  return row?.validationGid ?? null;
}

/**
 * The settings page's loader half. NEVER THROWS.
 *
 * A settings page that 500s over a GraphQL blip is a settings page the merchant
 * cannot use to fix anything — so a transport failure degrades to the
 * unregistered shape (honest: we could not confirm a live rule) carrying the
 * default copy, and the incident goes to Sentry instead of to the merchant.
 */
export async function readValidationConfig(
  shop: string,
): Promise<ValidationConfigState> {
  const fallback: ValidationConfigState = {
    status: "unregistered",
    messages: { ...DEFAULT_MESSAGES },
  };

  try {
    const gid = await readValidationGid(shop);
    if (!gid) return fallback;

    const response = await graphqlJson<ValidationConfigResponse>(
      shop,
      READ_VALIDATION_CONFIG_QUERY,
      { variables: { id: gid }, label: "ValidationConfig" },
    );

    const validation = response.data?.validation;
    // A stored GID pointing at nothing means the merchant deleted the rule. The
    // next app-open's ensure-step recreates it; until then, unregistered is the
    // true answer.
    if (!validation?.id) return fallback;

    return {
      status: validation.enabled ? "active" : "disabled",
      messages: parseConfigValue(validation.metafield?.value),
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { settings: "read-validation-config", shop },
    });
    return fallback;
  }
}

/**
 * The live flag state of one Validation, read immediately before an update so
 * the update can echo it (see UPDATE_VALIDATION_MUTATION for why).
 *
 * Deliberately NOT `readValidationConfig`: that one degrades a transport blip
 * to the `unregistered` shape so the settings PAGE still renders. Here the two
 * must stay distinct — "the rule is gone" and "we could not ask" call for
 * different answers, and only one of them is safe to write after.
 */
type ValidationFlags =
  | { ok: true; enabled: boolean; blockOnFailure: boolean }
  | { ok: false; reason: "missing" | "error" };

async function readValidationFlags(
  shop: string,
  gid: string,
): Promise<ValidationFlags> {
  try {
    const response = await graphqlJson<ValidationConfigResponse>(
      shop,
      READ_VALIDATION_CONFIG_QUERY,
      { variables: { id: gid }, label: "ValidationConfig" },
    );

    const validation = response.data?.validation;
    if (!validation?.id) return { ok: false, reason: "missing" };

    return {
      ok: true,
      enabled: validation.enabled === true,
      // An absent flag falls back to the ENFC-04 value the app pins at
      // registration. `undefined` must never reach the wire — an absent key is
      // precisely what caused the live regression this echo exists to prevent.
      blockOnFailure: validation.blockOnFailure === true,
    };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { settings: "read-validation-flags", shop },
    });
    return { ok: false, reason: "error" };
  }
}

export type UpdateMessagesResult =
  | { ok: true }
  | { ok: false; code: "invalid" | "unregistered" | "save-failed" };

/**
 * Write the merchant's copy to config_v1. NEVER THROWS to the route.
 *
 * Two failure modes are reported distinctly because they call for different
 * merchant actions: `unregistered` means there is no rule to write to yet (open
 * the app after granting permissions), while `save-failed` means the write was
 * attempted and Shopify refused it.
 *
 * userErrors arrive INSIDE `data` with a 200 and an empty top-level `errors[]`
 * (the 03-01 trap — `graphqlJson` cannot throw on them). Reading past them is
 * how an app tells a merchant their copy is live while buyers still see the old
 * text (T-04-15).
 *
 * Lengths are re-validated here even though the route already did: this is the
 * last gate before a string reaches a buyer's checkout, and a future second
 * caller must not be able to skip it.
 */
export async function updateValidationMessages(
  shop: string,
  messages: ValidationMessages,
): Promise<UpdateMessagesResult> {
  const overLimit = validateMessage(messages.overLimit);
  const overdue = validateMessage(messages.overdue);
  if (!overLimit.ok || !overdue.ok) return { ok: false, code: "invalid" };

  const gid = await readValidationGid(shop);
  if (!gid) return { ok: false, code: "unregistered" };

  // Read the live flags FIRST. Writing without them is writing blind, and a
  // blind write is what silently disabled a real merchant's rule (04-05).
  const flags = await readValidationFlags(shop, gid);
  if (!flags.ok) {
    return {
      ok: false,
      // "The rule is gone" is actionable (re-open the app; the ensure-step
      // recreates it). "We could not ask" is not — and neither is a licence to
      // write anyway.
      code: flags.reason === "missing" ? "unregistered" : "save-failed",
    };
  }

  try {
    const response = await graphqlJson<ValidationUpdateResponse>(
      shop,
      UPDATE_VALIDATION_MUTATION,
      {
        variables: {
          id: gid,
          validation: {
            // Echoed, never assumed — validationUpdate re-defaults what it is
            // not told.
            //
            // WINDOWS #12 — TOCTOU, acknowledged: `flags` was read immediately
            // above, and these two lines write it back. A merchant who toggles
            // the rule under Settings > Checkout inside that window — a single
            // round trip — has their toggle REVERTED by this echo, because the
            // value we echo is the one we read a moment before they changed it.
            // The platform offers no compare-and-set on `validationUpdate`: no
            // `ifMatch`, no version token, nothing to make this write
            // conditional on the state we read. The remedy is therefore
            // acceptance, not code. Severity is LOW because the outcome is a
            // VISIBLE reversion rather than a silent disablement — the Settings
            // status banner renders the LIVE flags on the next load, so the
            // merchant sees the rule back in its old state and can simply
            // toggle it again. Contrast the bug this echo exists to fix (04-05),
            // where writing blind DID silently disable a real merchant's rule
            // with nothing on screen to say so. Found by 04-VERIFICATION (W1);
            // register entry T-06-09, disposition accept.
            enable: flags.enabled,
            blockOnFailure: flags.blockOnFailure,
            metafields: [
              {
                namespace: CONFIG_METAFIELD_NAMESPACE,
                key: CONFIG_METAFIELD_KEY,
                type: "json",
                value: buildConfigValue({
                  overLimit: overLimit.value,
                  overdue: overdue.value,
                }),
              },
            ],
          },
        },
        label: "UpdateValidationConfig",
      },
    );

    const userErrors = response.data?.validationUpdate?.userErrors ?? [];
    if (userErrors.length > 0) {
      Sentry.captureException(
        new ValidationRegistrationError(shop, "UpdateValidationConfig", userErrors),
        { tags: { settings: "update-validation-messages", shop } },
      );
      return { ok: false, code: "save-failed" };
    }

    return { ok: true };
  } catch (error) {
    Sentry.captureException(error, {
      tags: { settings: "update-validation-messages", shop },
    });
    return { ok: false, code: "save-failed" };
  }
}
