-- CreateEnum
CREATE TYPE "GlassModStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "InventoryLedger" ADD COLUMN     "glassModId" TEXT;

-- CreateTable
CREATE TABLE "GlassMod" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT,
    "customer" TEXT,
    "loadDate" DATE,
    "dueDate" DATE,
    "sourceProductId" TEXT NOT NULL,
    "targetProductId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "status" "GlassModStatus" NOT NULL DEFAULT 'QUEUED',
    "note" TEXT,
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GlassMod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GlassMod_status_idx" ON "GlassMod"("status");

-- CreateIndex
CREATE INDEX "GlassMod_dueDate_idx" ON "GlassMod"("dueDate");

-- CreateIndex
CREATE INDEX "InventoryLedger_glassModId_idx" ON "InventoryLedger"("glassModId");

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_glassModId_fkey" FOREIGN KEY ("glassModId") REFERENCES "GlassMod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlassMod" ADD CONSTRAINT "GlassMod_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlassMod" ADD CONSTRAINT "GlassMod_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlassMod" ADD CONSTRAINT "GlassMod_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GlassMod" ADD CONSTRAINT "GlassMod_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
