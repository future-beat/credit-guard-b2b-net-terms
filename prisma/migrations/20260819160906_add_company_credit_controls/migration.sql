-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bypassEnforcement" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditLimit" DECIMAL(19,4),
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "publishedStateHash" TEXT;
