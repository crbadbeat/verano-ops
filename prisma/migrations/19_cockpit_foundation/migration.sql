-- Cockpit foundation: additive schema for the WMS overhaul waves.
-- Batched up front so the parallel tracks (Admin, Ops flow, Inventory,
-- Dashboards) add NO further migrations and cannot collide. Everything here is
-- additive and nullable — no backfill, no data change.

-- AlterEnum
-- EXECUTIVE: read-only, all-site leadership dashboards. Adding the value only
-- (never used in this transaction), so it is safe inside the migration txn on PG15.
ALTER TYPE "UserRole" ADD VALUE 'EXECUTIVE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "badgeCode" TEXT,
ADD COLUMN     "homeWarehouseId" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "mustResetPassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinHash" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "standardCostCents" INTEGER;

-- AlterTable
ALTER TABLE "DeliveryTrip" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveredById" TEXT,
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "driverId" TEXT,
ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "qcAt" TIMESTAMP(3),
ADD COLUMN     "qcById" TEXT,
ADD COLUMN     "qcNote" TEXT,
ADD COLUMN     "signatureData" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "UserSite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserSite_userId_idx" ON "UserSite"("userId");

-- CreateIndex
CREATE INDEX "UserSite_locationId_idx" ON "UserSite"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSite_userId_locationId_key" ON "UserSite"("userId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_badgeCode_key" ON "User"("badgeCode");

-- CreateIndex
CREATE INDEX "InventoryLedger_reason_createdAt_idx" ON "InventoryLedger"("reason", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryLedger_createdAt_idx" ON "InventoryLedger"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_homeWarehouseId_fkey" FOREIGN KEY ("homeWarehouseId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSite" ADD CONSTRAINT "UserSite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSite" ADD CONSTRAINT "UserSite_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_qcById_fkey" FOREIGN KEY ("qcById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_deliveredById_fkey" FOREIGN KEY ("deliveredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
