-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "isHistorical" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Order_isHistorical_idx" ON "Order"("isHistorical");

