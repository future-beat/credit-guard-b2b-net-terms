-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "companyGid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exposure" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "overdue" BOOLEAN NOT NULL DEFAULT false,
    "earliestDueAt" TIMESTAMP(3),
    "recomputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderGid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT,
    "companyLocationGid" TEXT,
    "hasPaymentTerms" BOOLEAN NOT NULL,
    "paymentTermsType" TEXT,
    "financialStatus" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "outstandingShop" DECIMAL(19,4) NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "refetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LedgerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerSchedule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "scheduleGid" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "balanceDueAmount" DECIMAL(19,4),
    "balanceDueCurrency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncCursor" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SweepLease" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SweepLease_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "Company_shop_overdue_idx" ON "Company"("shop", "overdue");

-- CreateIndex
CREATE UNIQUE INDEX "Company_shop_companyGid_key" ON "Company"("shop", "companyGid");

-- CreateIndex
CREATE INDEX "LedgerOrder_shop_companyId_idx" ON "LedgerOrder"("shop", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerOrder_shop_orderGid_key" ON "LedgerOrder"("shop", "orderGid");

-- CreateIndex
CREATE INDEX "LedgerSchedule_shop_dueAt_idx" ON "LedgerSchedule"("shop", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerSchedule_shop_scheduleGid_key" ON "LedgerSchedule"("shop", "scheduleGid");

-- CreateIndex
CREATE INDEX "WebhookReceipt_shop_idx" ON "WebhookReceipt"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "SyncCursor_shop_key_key" ON "SyncCursor"("shop", "key");

-- AddForeignKey
ALTER TABLE "LedgerOrder" ADD CONSTRAINT "LedgerOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerSchedule" ADD CONSTRAINT "LedgerSchedule_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "LedgerOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
