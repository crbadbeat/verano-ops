-- CreateEnum
CREATE TYPE "StockCondition" AS ENUM ('NEW', 'SHOW_GOOD');

-- AlterTable
ALTER TABLE "InventoryLedger" ADD COLUMN     "condition" "StockCondition" NOT NULL DEFAULT 'NEW';

-- AlterTable
ALTER TABLE "CountEntry" ADD COLUMN     "condition" "StockCondition" NOT NULL DEFAULT 'NEW';

-- CreateIndex
CREATE INDEX "InventoryLedger_productId_locationId_condition_idx" ON "InventoryLedger"("productId", "locationId", "condition");
