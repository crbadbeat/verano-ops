-- CreateEnum
CREATE TYPE "BuildCategory" AS ENUM ('SPECIAL', 'PARENT', 'CHILD');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "buildCategory" "BuildCategory",
ADD COLUMN     "maxStockLevel" INTEGER,
ADD COLUMN     "parentSku" TEXT;

-- CreateIndex
CREATE INDEX "Product_parentSku_idx" ON "Product"("parentSku");
