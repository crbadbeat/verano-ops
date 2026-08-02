-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "LedgerReason" AS ENUM ('SEED', 'ADJUSTMENT', 'SHIPMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "SnapshotStatus" AS ENUM ('PENDING', 'APPROVED', 'REVERSED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickAlias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "powerBiItem" TEXT NOT NULL,
    "powerBiDetail" TEXT,
    "category" TEXT,
    "matchKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLedger" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qtyDelta" INTEGER NOT NULL,
    "reason" "LedgerReason" NOT NULL,
    "note" TEXT,
    "tripSnapshotId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripSnapshot" (
    "id" TEXT NOT NULL,
    "tripName" TEXT NOT NULL,
    "loadDate" DATE NOT NULL,
    "loadId" TEXT,
    "status" "SnapshotStatus" NOT NULL DEFAULT 'PENDING',
    "rawJson" JSONB NOT NULL,
    "fetchedById" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "TripSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripSnapshotLine" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "orderNo" TEXT,
    "orderCustomer" TEXT,
    "category" TEXT,
    "item" TEXT NOT NULL,
    "itemDetail" TEXT,
    "qty" INTEGER NOT NULL,
    "productId" TEXT,

    CONSTRAINT "TripSnapshotLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_sku_idx" ON "Product"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "PickAlias_matchKey_key" ON "PickAlias"("matchKey");

-- CreateIndex
CREATE INDEX "PickAlias_productId_idx" ON "PickAlias"("productId");

-- CreateIndex
CREATE INDEX "InventoryLedger_productId_idx" ON "InventoryLedger"("productId");

-- CreateIndex
CREATE INDEX "InventoryLedger_tripSnapshotId_idx" ON "InventoryLedger"("tripSnapshotId");

-- CreateIndex
CREATE INDEX "TripSnapshot_tripName_loadDate_idx" ON "TripSnapshot"("tripName", "loadDate");

-- CreateIndex
CREATE INDEX "TripSnapshot_loadId_idx" ON "TripSnapshot"("loadId");

-- CreateIndex
CREATE INDEX "TripSnapshotLine_snapshotId_idx" ON "TripSnapshotLine"("snapshotId");

-- AddForeignKey
ALTER TABLE "PickAlias" ADD CONSTRAINT "PickAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_tripSnapshotId_fkey" FOREIGN KEY ("tripSnapshotId") REFERENCES "TripSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSnapshot" ADD CONSTRAINT "TripSnapshot_fetchedById_fkey" FOREIGN KEY ("fetchedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSnapshotLine" ADD CONSTRAINT "TripSnapshotLine_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "TripSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSnapshotLine" ADD CONSTRAINT "TripSnapshotLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

