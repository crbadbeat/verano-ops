-- Item Master reset: anchor purchased items on NetSuite's constant internal
-- NUMBER (stable) rather than the mutable item NAME, and carry the name as a
-- display-only "description". Bases/Glass keep their smart-SKU. The number is the
-- new stable identity; nullable because the app still auto-creates configured
-- Bases/Tops that aren't NetSuite items yet.
--
-- Additive only.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "netsuiteNumber" TEXT,
ADD COLUMN     "description" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Product_netsuiteNumber_key" ON "Product"("netsuiteNumber");
