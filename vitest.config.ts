import { defineConfig } from "vitest/config";

/**
 * Wave 0 test infrastructure (01-VALIDATION.md). The template ships no test
 * framework; vitest 4 is the major that peer-supports the template's Vite 7.
 *
 * A dedicated vitest.config.ts (rather than a `test` block inside
 * vite.config.ts) is deliberate: it keeps the React Router and Sentry build
 * plugins out of the test pipeline, so importing `app/shopify.server.ts` in a
 * node test does not drag in the client bundler or Sentry's build machinery.
 */

/**
 * Tests run against `creditguard_test` and MUST NEVER touch `creditguard_dev`
 * (01-03 acceptance criteria). Prisma — unlike psql — will not fall back to the
 * OS user, so the URL always carries an explicit role.
 * Override wholesale with TEST_DATABASE_URL when the local role differs.
 */
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${process.env.USER ?? "postgres"}@localhost:5432/creditguard_test`;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every suite shares one Postgres database. Serial files keep row-count
    // assertions (retention, zero-rows-after-redact) deterministic and keep the
    // Prisma connection pool to a single client.
    fileParallelism: false,
    /**
     * These are set before any test file — and therefore before
     * `app/shopify.server.ts` — is imported. SHOPIFY_API_SECRET is the key the
     * signed-webhook helper signs with, so it must be a fixed, committed dummy:
     * the real secret is never present in, or needed by, the test run.
     */
    env: {
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "test-webhook-secret-not-a-real-secret",
      SHOPIFY_APP_URL: "https://app.creditguard.test",
      // Lockstep with shopify.app.toml's access_scopes (CF-1 + the Phase-3,
      // Phase-4 and Phase-5 write scopes) and the Railway SCOPES variable.
      // app/shopify.server.ts reads this at import time, so a test run with a
      // different string would exercise a differently-configured app than the
      // one that ships.
      SCOPES:
        "read_orders,read_all_orders,read_payment_terms,read_companies,write_companies,write_validations,write_orders",
      DATABASE_URL: testDatabaseUrl,
    },
  },
});
