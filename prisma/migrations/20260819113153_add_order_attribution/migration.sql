-- AlterTable
ALTER TABLE "LedgerOrder" ADD COLUMN     "attributionStatus" TEXT NOT NULL DEFAULT 'UNRESOLVED';

-- CreateIndex
CREATE INDEX "LedgerOrder_shop_attributionStatus_idx" ON "LedgerOrder"("shop", "attributionStatus");
