import type {
  CartValidationsGenerateRunInput,
  CartValidationsGenerateRunResult,
} from "../generated/api";

/**
 * Credit Guard checkout enforcement — the ONLY place a B2B checkout is blocked.
 *
 * This module is deliberately pure and dependency-free: the root vitest suite
 * (tests/checkout-validation-function.test.ts) imports `run` directly and
 * exercises every branch without a wasm runtime. The only import is type-only,
 * so nothing from the Function glue is pulled in at test time.
 *
 * ------------------------------------------------------------------ contract
 * Input side: `cart.buyerIdentity.purchasingCompany.company.metafield(key:
 * "credit_v1").jsonValue` — the credit_v1 payload published by
 * app/services/metafields.server.ts. Its byte-exact shape is locked by
 * tests/metafield-contract.test.ts; the fixtures in this plan's test file are
 * GENERATED from those same strings, because a Function builds as a separate
 * workspace and cannot import server code.
 *
 * Output side: `{ operations: [{ validationAdd: { errors: [{ message, target:
 * "$.cart" }] } }] }` (API 2026-07). Pre-2025-10 tutorials show a flat `errors`
 * array with a `localizedMessage` field — that shape is dead, see generated/api.ts.
 *
 * ------------------------------------------------------------ decision order
 * The order below is LOCKED (04-01-PLAN, 04-CONTEXT). Reordering it changes
 * merchant-visible behaviour and will turn pinned tests red on purpose.
 *
 *   0. whole body try/catch                    -> allow   (ENFC-04 belt)
 *   1. purchasingCompany null                  -> allow   (D2C is never touched)
 *   2. credit_v1 absent / not an object        -> allow
 *   3. v !== 1                                 -> allow   (unknown payload version)
 *   4. overdue/bypass not booleans             -> allow   (malformed)
 *   5. bypass === true                         -> allow   (D-03, FIRST check)
 *   6. limit null/absent                       -> allow   (observe-only, CRED-04)
 *   7. overdue === true                        -> BLOCK   (ENFC-02)
 *   8. limit/exposure money grammar            -> allow on malformed (limit rule only)
 *   9. block-all special case                  -> skip the currency gate (F-02)
 *  10. currency gate                           -> allow on mismatch (D4-02)
 *  11. cart amount normalization               -> allow on malformed
 *  12. exposure + cart > limit                 -> BLOCK   (ENFC-01, D4-01)
 *
 * Two orderings in there are load-bearing and non-obvious:
 *
 * F-01 — overdue (7) is checked BEFORE money parsing (8). Fail-open is PER
 * RULE, not per payload: a garbage `limit` string must not silence ENFC-02 on a
 * company the merchant has explicitly configured. So `limit: "not-money"` with
 * `overdue: true` still blocks (with the overdue message), while the same
 * payload with `overdue: false` allows because the limit rule alone fails open.
 * This deviates from the 04-RESEARCH skeleton's grammar-before-overdue order on
 * purpose; the pinning test exists so a "cleanup" refactor cannot revert it.
 *
 * F-02 — the block-all special case (9) skips the currency gate. `limit:
 * "0.00"` is the merchant's deliberate block-all switch (D-02, byte-distinct
 * from `limit: null`). Zero remaining credit is exceeded in every currency and
 * no conversion is involved, so the legal `currency: null` zero-order payload
 * (metafields.server.ts payload law rule 5 — a company with no ledger rows at
 * all) must not disarm it. A NON-zero limit with a null/mismatched currency
 * still skips the limit rule, per D4-02.
 *
 * `data_complete` is deliberately not read: UNRESOLVED ledger rows carry
 * companyId null by construction, so incomplete data can only UNDERSTATE
 * exposure, which can only under-block — never falsely block. Suppressing
 * enforcement on data_complete:false would be strictly worse (D-04 decision,
 * answered Phase 4; 04-RESEARCH Q5.1).
 *
 * There is no clock here: the wasm runtime is deterministic, so `computed_at`
 * cannot be aged and is informational only. Staleness is bounded server-side by
 * webhook latency plus the hourly publish backstop (04-RESEARCH Q5.3).
 */

/**
 * Fallback block copy (P4-L4). Duplicated from plan 04-03's DEFAULT_MESSAGES by
 * design — the wasm cannot import server code — and kept in ONE exported const
 * so 04-04's settings-page copy review can diff the two sources mechanically.
 *
 * ENFC-03 posture: a missing or malformed config must never fail closed AND
 * never silence a block. Falling back per-field is what keeps both true.
 */
export const DEFAULT_MESSAGES = {
  overLimit:
    "Your company has reached its credit limit with us. To place this order, please contact us or settle open invoices to free up available credit.",
  overdue:
    "Your account has overdue invoices. New orders on payment terms are paused until the balance is settled — please contact us to arrange payment.",
} as const;

/** Mirror of the server-side cap in 04-04; a longer string falls back. */
const MAX_MESSAGE_LENGTH = 250;

/**
 * credit_v1 money grammar. Payload money is exactly 2dp by construction
 * (Decimal.toFixed(2), contract-test-locked). `exposure` may be negative —
 * refund history can push a company's balance below zero.
 */
const PAYLOAD_MONEY = /^-?\d{1,15}\.\d{2}$/;

/**
 * Cart money grammar. Shopify hands us a Decimal string with an UNKNOWN number
 * of decimal places, so the fraction is optional and variable-width here.
 */
const CART_MONEY = /^(\d{1,15})(?:\.(\d{1,6}))?$/;

type Messages = { overLimit: string; overdue: string };

/** A fresh allow verdict every call — never a shared mutable singleton. */
function allow(): CartValidationsGenerateRunResult {
  return { operations: [] };
}

function block(message: string): CartValidationsGenerateRunResult {
  return {
    operations: [{ validationAdd: { errors: [{ message, target: "$.cart" }] } }],
  };
}

/**
 * Payload money string -> integer cents. String surgery only: strip the decimal
 * point and read the remaining integer. Never any float arithmetic anywhere
 * near money (T-04-01: a formatting bug here phantom-blocks a paying customer).
 */
function payloadCents(raw: string): number | null {
  if (!PAYLOAD_MONEY.test(raw)) return null;
  const value = Number(raw.replace(".", ""));
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Cart amount -> integer cents, normalizing an unknown decimal width to two
 * digits. Truncation (not rounding) is deliberate: it can only make the cart
 * cheaper, and a cheaper cart can only under-block.
 */
function cartCents(raw: string): number | null {
  const matched = CART_MONEY.exec(raw);
  if (!matched) return null;
  const whole = Number(matched[1]);
  const fraction = Number(((matched[2] ?? "") + "00").slice(0, 2));
  const value = whole * 100 + fraction;
  return Number.isSafeInteger(value) ? value : null;
}

function usableMessage(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  if (candidate.length === 0 || candidate.length > MAX_MESSAGE_LENGTH) return null;
  return candidate;
}

/**
 * config_v1 (a metafield on the Validation object) -> the two block messages,
 * falling back FIELD BY FIELD. A wrong version, a non-object, a missing field
 * or an over-long string each degrade to the default copy rather than
 * suppressing the block.
 */
export function messagesFrom(jsonValue: unknown): Messages {
  if (jsonValue === null || typeof jsonValue !== "object" || Array.isArray(jsonValue)) {
    return { ...DEFAULT_MESSAGES };
  }
  const config = jsonValue as Record<string, unknown>;
  if (config.v !== 1) return { ...DEFAULT_MESSAGES };
  return {
    overLimit: usableMessage(config.over_limit_message) ?? DEFAULT_MESSAGES.overLimit,
    overdue: usableMessage(config.overdue_message) ?? DEFAULT_MESSAGES.overdue,
  };
}

export function run(
  input: CartValidationsGenerateRunInput,
): CartValidationsGenerateRunResult {
  try {
    // (1) No purchasing company: D2C, or a B2B storefront session without one.
    // Nothing this app knows about applies. This is the branch that carries
    // "no other checkout is ever affected".
    const purchasingCompany = input.cart.buyerIdentity?.purchasingCompany;
    if (!purchasingCompany) return allow();

    // (2) Never published, deleted, or not an object -> nothing to enforce.
    const raw: unknown = purchasingCompany.company.metafield?.jsonValue;
    if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
      return allow();
    }
    const payload = raw as Record<string, unknown>;

    // (3) A payload we do not understand. credit_v2 will ship alongside
    // credit_v1, never as an in-place rename, so an unknown v means a reader
    // that predates the writer — allow.
    if (payload.v !== 1) return allow();

    // (4) Malformed state flags.
    if (typeof payload.overdue !== "boolean" || typeof payload.bypass !== "boolean") {
      return allow();
    }

    // (5) Bypass is the merchant's per-company override and outranks BOTH
    // rules (D-03, restated by 03-VERIFICATION item 5). It must be the first
    // enforcement check so no later branch can block a bypassed company.
    if (payload.bypass === true) return allow();

    // (6) Observe-only. A fresh install enforces nothing: every company stays
    // exempt from BOTH rules until the merchant sets its limit (CRED-04).
    // Setting any limit — including "0.00", which is block-all and byte-
    // distinct from null (D-02) — is the per-company enforcement opt-in.
    // An absent key is treated the same as null: it is indistinguishable from
    // "unconfigured", and never surprise-blocking is the safe direction.
    if (payload.limit === null || payload.limit === undefined) return allow();

    const messages = messagesFrom(input.validation.metafield?.jsonValue);

    // (7) ENFC-02. Currency-independent (a boolean), and placed BEFORE money
    // parsing so a malformed limit string cannot silence it — see F-01 above.
    if (payload.overdue === true) return block(messages.overdue);

    // (8) From here on it is the limit rule only, and every failure fails open
    // for that rule alone; overdue has already had its say.
    if (typeof payload.limit !== "string" || typeof payload.exposure !== "string") {
      return allow();
    }
    const limitCents = payloadCents(payload.limit);
    const exposureCents = payloadCents(payload.exposure);
    if (limitCents === null || exposureCents === null || limitCents < 0) return allow();

    // (9) Block-all (F-02): zero remaining credit is exceeded in every
    // currency, so this one case skips the currency gate below.
    const blockAll = limitCents === 0 && exposureCents >= 0;

    // (10) D4-02: compare only within one currency, and never convert. A stale
    // presentmentCurrencyRate false-blocking a paying customer is the
    // instant-uninstall scenario, so the mismatch fails open for the limit rule
    // (overdue already blocked at step 7). Phase 6's dashboard surfaces the
    // affected companies so the hole is visible rather than silent.
    const total = input.cart.cost.totalAmount;
    if (!blockAll) {
      if (typeof payload.currency !== "string") return allow();
      if (String(total.currencyCode) !== payload.currency) return allow();
    }

    // (11) Unknown decimal width, and a cart total we cannot read is a cart we
    // do not block.
    const cartTotalCents = cartCents(String(total.amount));
    if (cartTotalCents === null) return allow();

    // (12) ENFC-01, remaining-credit semantics (D4-01): block iff this cart
    // would push the company PAST its limit. At-limit exactly (sum == limit) is
    // allowed, matching Phase 3's at-limit-is-within boundary.
    const projected = exposureCents + cartTotalCents;
    if (!Number.isSafeInteger(projected)) return allow();
    if (projected > limitCents) return block(messages.overLimit);

    return allow();
  } catch {
    // (0) Belt. blockOnFailure: false (set at registration, plan 04-03) is the
    // braces — but no code path above may RELY on throwing to reach here.
    return allow();
  }
}

/**
 * The name the Function runtime binds to the `cart.validations.generate.run`
 * target (see `export` in shopify.extension.toml). Kept as a thin delegate so
 * the decision logic stays in one pure, directly-importable `run`.
 */
export function cartValidationsGenerateRun(
  input: CartValidationsGenerateRunInput,
): CartValidationsGenerateRunResult {
  return run(input);
}
