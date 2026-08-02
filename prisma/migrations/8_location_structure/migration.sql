-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "aisle" TEXT,
ADD COLUMN     "bay" TEXT,
ADD COLUMN     "isDefaultWarehouse" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "level" INTEGER;

-- CreateIndex
CREATE INDEX "Location_aisle_idx" ON "Location"("aisle");
