-- CreateEnum
CREATE TYPE "Division" AS ENUM ('PGI', 'PGD');

-- CreateEnum
CREATE TYPE "NetsuiteReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'NEEDS_NETSUITE_FIX');

-- AlterEnum
ALTER TYPE "OrderSource" ADD VALUE 'NETSUITE';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ACCOUNTING';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "division" "Division",
ADD COLUMN     "estCogsCents" INTEGER,
ADD COLUMN     "netsuiteEntityId" TEXT,
ADD COLUMN     "netsuiteLastModifiedAt" TIMESTAMP(3),
ADD COLUMN     "netsuiteReviewStatus" "NetsuiteReviewStatus",
ADD COLUMN     "netsuiteSyncedAt" TIMESTAMP(3),
ADD COLUMN     "netsuiteTransactionId" TEXT,
ADD COLUMN     "trueCogsCents" INTEGER;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "costSnapshotCents" INTEGER,
ADD COLUMN     "estCostCents" INTEGER,
ADD COLUMN     "netsuiteLineId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_netsuiteTransactionId_key" ON "Order"("netsuiteTransactionId");

-- CreateIndex
CREATE INDEX "Order_netsuiteReviewStatus_idx" ON "Order"("netsuiteReviewStatus");
