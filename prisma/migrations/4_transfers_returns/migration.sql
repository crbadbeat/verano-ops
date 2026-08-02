-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('STAGED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('FLAGGED', 'CHECKED_IN', 'CANCELLED');

-- AlterTable
ALTER TABLE "InventoryLedger" ADD COLUMN     "returnOrderId" TEXT,
ADD COLUMN     "transferId" TEXT;

-- AlterTable
ALTER TABLE "TripSnapshot" ADD COLUMN     "driverName" TEXT,
ADD COLUMN     "qcAt" TIMESTAMP(3),
ADD COLUMN     "qcById" TEXT,
ADD COLUMN     "signatureData" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "destWarehouseId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'STAGED',
    "driverName" TEXT,
    "signatureData" TEXT,
    "signedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "rawJson" JSONB,
    "createdById" TEXT,
    "receivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT,
    "orderNo" TEXT,
    "itemLabel" TEXT,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "TransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnOrder" (
    "id" TEXT NOT NULL,
    "reference" TEXT,
    "reason" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'FLAGGED',
    "rawJson" JSONB,
    "createdById" TEXT,
    "checkedInById" TEXT,
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnOrderLine" (
    "id" TEXT NOT NULL,
    "returnOrderId" TEXT NOT NULL,
    "productId" TEXT,
    "orderNo" TEXT,
    "itemLabel" TEXT,
    "expectedQty" INTEGER NOT NULL,
    "checkedInQty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReturnOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transfer_status_idx" ON "Transfer"("status");

-- CreateIndex
CREATE INDEX "Transfer_destWarehouseId_idx" ON "Transfer"("destWarehouseId");

-- CreateIndex
CREATE INDEX "TransferLine_transferId_idx" ON "TransferLine"("transferId");

-- CreateIndex
CREATE INDEX "TransferLine_productId_idx" ON "TransferLine"("productId");

-- CreateIndex
CREATE INDEX "ReturnOrder_status_idx" ON "ReturnOrder"("status");

-- CreateIndex
CREATE INDEX "ReturnOrderLine_returnOrderId_idx" ON "ReturnOrderLine"("returnOrderId");

-- CreateIndex
CREATE INDEX "ReturnOrderLine_productId_idx" ON "ReturnOrderLine"("productId");

-- CreateIndex
CREATE INDEX "InventoryLedger_transferId_idx" ON "InventoryLedger"("transferId");

-- CreateIndex
CREATE INDEX "InventoryLedger_returnOrderId_idx" ON "InventoryLedger"("returnOrderId");

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_returnOrderId_fkey" FOREIGN KEY ("returnOrderId") REFERENCES "ReturnOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSnapshot" ADD CONSTRAINT "TripSnapshot_qcById_fkey" FOREIGN KEY ("qcById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_destWarehouseId_fkey" FOREIGN KEY ("destWarehouseId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransferLine" ADD CONSTRAINT "TransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOrder" ADD CONSTRAINT "ReturnOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOrder" ADD CONSTRAINT "ReturnOrder_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOrderLine" ADD CONSTRAINT "ReturnOrderLine_returnOrderId_fkey" FOREIGN KEY ("returnOrderId") REFERENCES "ReturnOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnOrderLine" ADD CONSTRAINT "ReturnOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
