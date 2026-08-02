-- Per-warehouse average cost from NetSuite. Additive only:
--   • Location.netsuiteId  — the NetSuite location a WMS warehouse mirrors (unique)
--   • ProductLocationCost  — NetSuite average cost per (product, warehouse)
-- The nightly sync writes ProductLocationCost only for warehouses whose netsuiteId
-- is set; unlinked warehouses and unmapped NetSuite locations are skipped.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "netsuiteId" INTEGER;

-- CreateTable
CREATE TABLE "ProductLocationCost" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "averageCostCents" INTEGER NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductLocationCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductLocationCost_locationId_idx" ON "ProductLocationCost"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductLocationCost_productId_locationId_key" ON "ProductLocationCost"("productId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_netsuiteId_key" ON "Location"("netsuiteId");

-- AddForeignKey
ALTER TABLE "ProductLocationCost" ADD CONSTRAINT "ProductLocationCost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductLocationCost" ADD CONSTRAINT "ProductLocationCost_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
