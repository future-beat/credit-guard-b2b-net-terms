import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

import {
  creditStateHash,
  serializeCreditState,
} from "../app/services/metafields.server";

/**
 * credit_v1 CONTRACT LOCK (D-02, D-04, CRED-03, CRED-04, T-03-07).
 *
 * These fixtures are the executable spec of the ONLY server↔Function
 * interface, and they are the source Phase 4's checkout Function fixtures are
 * GENERATED FROM (Functions build as a separate workspace and cannot import
 * app server code — these byte-exact strings, not a shared import, are the
 * cross-boundary contract carrier). Every assertion here is on the exact
 * serialized bytes: JSON.parse-then-deep-equal PLUS raw-substring checks, so
 * a number-vs-string regression cannot hide behind parse equality.
 *
 * Changing any expected string below is a CONTRACT CHANGE: within credit_v1
 * only additive evolution is allowed; a breaking change ships as credit_v2
 * alongside, never an in-place rename (metafields.server.ts rule 3).
 */

const COMPUTED_AT = new Date("2026-08-19T22:10:00.000Z");

function fields(overrides: Partial<Parameters<typeof creditStateHash>[0]> = {}) {
  return {
    limit: null as Prisma.Decimal | null,
    exposure: new Prisma.Decimal("1874.95"),
    currency: "USD" as string | null,
    overdue: false,
    bypass: false,
    dataComplete: true,
    ...overrides,
  };
}

describe("serializeCreditState — byte-exact payload law", () => {
  it("null limit serializes as JSON null — byte-distinct from string zero (D-02)", () => {
    const serialized = serializeCreditState({
      ...fields({ limit: null }),
      computedAt: COMPUTED_AT,
    });
    // Raw substring: parse equality would not distinguish null from absent.
    expect(serialized).toContain('"limit":null');
    expect(serialized).not.toContain('"limit":"0.00"');
  });

  it('limit Decimal 0 serializes as the string "0.00" — block-all, not observe-only (D-02)', () => {
    const serialized = serializeCreditState({
      ...fields({ limit: new Prisma.Decimal(0) }),
      computedAt: COMPUTED_AT,
    });
    expect(serialized).toContain('"limit":"0.00"');
    expect(serialized).not.toContain('"limit":null');
    // Never a JSON number: "limit":0 must be unrepresentable.
    expect(serialized).not.toContain('"limit":0,');
  });

  it("a set limit serializes as a 2dp decimal string (CRED-04/precision)", () => {
    const serialized = serializeCreditState({
      ...fields({ limit: new Prisma.Decimal("5000") }),
      computedAt: COMPUTED_AT,
    });
    expect(serialized).toBe(
      '{"v":1,"limit":"5000.00","exposure":"1874.95","currency":"USD",' +
        '"overdue":false,"bypass":false,"data_complete":true,' +
        '"computed_at":"2026-08-19T22:10:00.000Z"}',
    );
  });

  it("exposure is always a decimal string, never a JSON number (CRED-03/precision)", () => {
    const serialized = serializeCreditState({
      ...fields(),
      computedAt: COMPUTED_AT,
    });
    expect(serialized).toContain('"exposure":"1874.95"');
    expect(serialized).not.toContain('"exposure":1874.95');
  });

  it("a 4dp ledger value rounds HALF_UP to 2dp (L-03 rounding law)", () => {
    const serialized = serializeCreditState({
      ...fields({ exposure: new Prisma.Decimal("10.005") }),
      computedAt: COMPUTED_AT,
    });
    expect(serialized).toContain('"exposure":"10.01"');
  });

  it("zero-order company publishes a COMPLETE payload — never absent or partial (CRED-03/empty)", () => {
    // L-04: null currency can only co-occur with exposure "0.00" — the shop
    // has no ledger rows at all, and the payload is still whole.
    const serialized = serializeCreditState({
      limit: null,
      exposure: new Prisma.Decimal(0),
      currency: null,
      overdue: false,
      bypass: false,
      dataComplete: true,
      computedAt: COMPUTED_AT,
    });
    expect(serialized).toBe(
      '{"v":1,"limit":null,"exposure":"0.00","currency":null,' +
        '"overdue":false,"bypass":false,"data_complete":true,' +
        '"computed_at":"2026-08-19T22:10:00.000Z"}',
    );
  });

  it("canonical key order is stable across calls (D-04)", () => {
    const order = [
      "v",
      "limit",
      "exposure",
      "currency",
      "overdue",
      "bypass",
      "data_complete",
      "computed_at",
    ];
    for (const input of [
      { ...fields(), computedAt: COMPUTED_AT },
      {
        ...fields({ limit: new Prisma.Decimal("1.50"), overdue: true }),
        computedAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    ]) {
      const keys = Object.keys(
        JSON.parse(serializeCreditState(input)) as Record<string, unknown>,
      );
      expect(keys).toEqual(order);
    }
  });

  it("locks the exact key set — a new field here is a reviewed contract change, never an accident (T-03-07)", () => {
    const payload = JSON.parse(
      serializeCreditState({ ...fields(), computedAt: COMPUTED_AT }),
    ) as Record<string, unknown>;
    // Money/state fields ONLY: no company name, no contact, no PII, ever.
    expect(Object.keys(payload).sort()).toEqual([
      "bypass",
      "computed_at",
      "currency",
      "data_complete",
      "exposure",
      "limit",
      "overdue",
      "v",
    ]);
  });
});

describe("creditStateHash — hash-skip identity", () => {
  it("excludes computed_at: the same state at two instants hashes identically", () => {
    // The hash keys the SKIP decision — a timestamp-only difference must not
    // force a metafieldsSet write every hour. Pinned to the sha256 of the
    // exact canonical form (v..data_complete, computed_at ABSENT): any
    // timestamp or salt leaking into the hash — even one that collides across
    // two immediate calls — flips this constant.
    const PINNED_HASH =
      "830b07b8862ab37548cf72ae64b521bf1053cc515962af1298427fbcf1d65dcb";
    expect(creditStateHash(fields())).toBe(PINNED_HASH);
    expect(creditStateHash(fields())).toBe(creditStateHash(fields()));
    // And serializations at different instants still share the one hash.
    const a = serializeCreditState({ ...fields(), computedAt: COMPUTED_AT });
    const b = serializeCreditState({
      ...fields(),
      computedAt: new Date("2026-08-20T09:00:00.000Z"),
    });
    expect(a).not.toBe(b);
  });

  it("every enforcement-relevant field flips the hash", () => {
    const base = creditStateHash(fields());
    expect(creditStateHash(fields({ limit: new Prisma.Decimal(0) }))).not.toBe(base);
    expect(creditStateHash(fields({ limit: new Prisma.Decimal("5000") }))).not.toBe(base);
    expect(creditStateHash(fields({ exposure: new Prisma.Decimal("1874.96") }))).not.toBe(base);
    expect(creditStateHash(fields({ currency: "EUR" }))).not.toBe(base);
    expect(creditStateHash(fields({ overdue: true }))).not.toBe(base);
    expect(creditStateHash(fields({ bypass: true }))).not.toBe(base);
    expect(creditStateHash(fields({ dataComplete: false }))).not.toBe(base);
  });

  it("null limit and zero limit hash differently (D-02 rides on this)", () => {
    expect(creditStateHash(fields({ limit: null }))).not.toBe(
      creditStateHash(fields({ limit: new Prisma.Decimal(0) })),
    );
  });
});
