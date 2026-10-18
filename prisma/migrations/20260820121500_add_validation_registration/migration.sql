-- App-managed Validation registration (ENFC-01/ENFC-02).
--
-- STRICTLY ADDITIVE, same F-05 rollback posture as add_enforcement_events: one
-- nullable column, no drop, rename or retype. Pre-migration application code
-- (i.e. `main` for the whole Phase 4 PR window) keeps running unchanged against
-- a database carrying this column.

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "validationGid" TEXT;
