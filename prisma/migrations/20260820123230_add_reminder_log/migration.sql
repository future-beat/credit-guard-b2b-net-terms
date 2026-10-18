-- Payment reminder log + the default-off reminder switch (REMD-01, D5-02).
--
-- STRICTLY ADDITIVE, same F-05 rollback posture as add_enforcement_events and
-- add_validation_registration: one new table and one NULLABLE column. No drop,
-- rename or retype appears here, so pre-migration application code (i.e.
-- `main` for the whole Phase 5 PR window) keeps running unchanged against a
-- migrated database.
--
-- The NULL default of "Shop"."remindersEnabledAt" is the safety property, not
-- an oversight: every existing and future row reads as "reminders off", so the
-- sweep this migration enables is inert until a merchant opts in.

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "remindersEnabledAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scheduleGid" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "companyGid" TEXT,
    "companyName" TEXT,
    "touchpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReminderLog_shop_createdAt_idx" ON "ReminderLog"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_shop_scheduleGid_touchpoint_key" ON "ReminderLog"("shop", "scheduleGid", "touchpoint");
