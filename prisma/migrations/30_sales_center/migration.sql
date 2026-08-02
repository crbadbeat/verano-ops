-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "netsuiteSalesCenterId" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "salesCenterId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Location_netsuiteSalesCenterId_key" ON "Location"("netsuiteSalesCenterId");

-- CreateIndex
CREATE INDEX "Order_salesCenterId_idx" ON "Order"("salesCenterId");

