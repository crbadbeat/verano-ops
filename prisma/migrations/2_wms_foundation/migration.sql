-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('WAREHOUSE', 'BIN');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'REVIEW', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountMethod" AS ENUM ('SCAN', 'MANUAL', 'CONFIG', 'CRATE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'MFG_MANAGER';
ALTER TYPE "UserRole" ADD VALUE 'WATERJET';
ALTER TYPE "UserRole" ADD VALUE 'RETURNS';
ALTER TYPE "UserRole" ADD VALUE 'DRIVER';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerReason" ADD VALUE 'COUNT';
ALTER TYPE "LedgerReason" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "LedgerReason" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "LedgerReason" ADD VALUE 'MANUFACTURE';
ALTER TYPE "LedgerReason" ADD VALUE 'CONSUME';
ALTER TYPE "LedgerReason" ADD VALUE 'RETURN';
ALTER TYPE "LedgerReason" ADD VALUE 'MOD_OUT';
ALTER TYPE "LedgerReason" ADD VALUE 'MOD_IN';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "attributes" JSONB,
ADD COLUMN     "crateSize" INTEGER;

-- AlterTable
ALTER TABLE "InventoryLedger" ADD COLUMN     "countSessionId" TEXT,
ADD COLUMN     "locationId" TEXT;

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LocationType" NOT NULL DEFAULT 'BIN',
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountSession" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "CountSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "locationId" TEXT,
    "productId" TEXT,
    "rawSku" TEXT,
    "qty" INTEGER NOT NULL,
    "crateCount" INTEGER,
    "method" "CountMethod" NOT NULL DEFAULT 'MANUAL',
    "countedById" TEXT,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "CountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE INDEX "Location_type_idx" ON "Location"("type");

-- CreateIndex
CREATE INDEX "CountSession_warehouseId_idx" ON "CountSession"("warehouseId");

-- CreateIndex
CREATE INDEX "CountSession_status_idx" ON "CountSession"("status");

-- CreateIndex
CREATE INDEX "CountEntry_sessionId_idx" ON "CountEntry"("sessionId");

-- CreateIndex
CREATE INDEX "CountEntry_locationId_idx" ON "CountEntry"("locationId");

-- CreateIndex
CREATE INDEX "CountEntry_productId_idx" ON "CountEntry"("productId");

-- CreateIndex
CREATE INDEX "InventoryLedger_productId_locationId_idx" ON "InventoryLedger"("productId", "locationId");

-- CreateIndex
CREATE INDEX "InventoryLedger_countSessionId_idx" ON "InventoryLedger"("countSessionId");

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_countSessionId_fkey" FOREIGN KEY ("countSessionId") REFERENCES "CountSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountSession" ADD CONSTRAINT "CountSession_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountSession" ADD CONSTRAINT "CountSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountSession" ADD CONSTRAINT "CountSession_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountEntry" ADD CONSTRAINT "CountEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CountSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountEntry" ADD CONSTRAINT "CountEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountEntry" ADD CONSTRAINT "CountEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CountEntry" ADD CONSTRAINT "CountEntry_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
