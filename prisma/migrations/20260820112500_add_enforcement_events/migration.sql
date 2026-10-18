-- Enforcement observability backend (ENFC-05 as re-scoped by D4-03, ENFC-06).
--
-- STRICTLY ADDITIVE by design (F-05 rollback story): one new column with a
-- database default and one new table. No drop, rename or retype appears here,
-- so the PRE-migration application code keeps running unchanged against a
-- migrated database — which is what lets `main` stay deployable for the whole
-- Phase 4 PR window while the branch carries the code that uses these.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "blockedState" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EnforcementEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "companyGid" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderGid" TEXT,
    "amount" DECIMAL(19,4),
    "channel" TEXT,
    "exposure" DECIMAL(19,4) NOT NULL,
    "limit" DECIMAL(19,4),
    "overdue" BOOLEAN NOT NULL,
    "bypass" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnforcementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnforcementEvent_shop_createdAt_idx" ON "EnforcementEvent"("shop", "createdAt");

-- CreateIndex
-- Postgres treats NULLs as distinct in a unique index, so this constrains
-- BYPASSED_ORDER rows (one per order — the ENFC-06 dedupe) without ever
-- constraining the NULL-orderGid transition and bypass-audit rows.
CREATE UNIQUE INDEX "EnforcementEvent_shop_kind_orderGid_key" ON "EnforcementEvent"("shop", "kind", "orderGid");
