-- Strictly additive: one nullable column, no default, no backfill, no rewrite
-- of existing rows. Every ReminderLog row written before this migration keeps
-- meaning exactly what it meant, with failureReason NULL.
--
-- The column holds a code-enforced TOKEN only — RATE_LIMITED | REFUSED |
-- TRANSPORT | REFETCH — never a raw Shopify message. See the FAILURE_REASON
-- constants in app/services/reminders.server.ts.

-- AlterTable
ALTER TABLE "ReminderLog" ADD COLUMN     "failureReason" TEXT;
