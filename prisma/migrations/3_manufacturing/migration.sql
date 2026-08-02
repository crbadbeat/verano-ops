-- CreateEnum
CREATE TYPE "JobStage" AS ENUM ('WELDING', 'BOARDING', 'STUCCO', 'ELECTRICAL', 'WRAPPING');

-- CreateEnum
CREATE TYPE "ManufacturingKind" AS ENUM ('JOB', 'MOD');

-- AlterTable
ALTER TABLE "InventoryLedger" ADD COLUMN     "manufacturingEntryId" TEXT;

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaseStyle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaseStyle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusRate" (
    "id" TEXT NOT NULL,
    "baseStyleId" TEXT NOT NULL,
    "stage" "JobStage" NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonusRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModReason" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BomComponent" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,

    CONSTRAINT "BomComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingEntry" (
    "id" TEXT NOT NULL,
    "kind" "ManufacturingKind" NOT NULL DEFAULT 'JOB',
    "productId" TEXT,
    "newProductId" TEXT,
    "baseStyleId" TEXT,
    "stage" "JobStage" NOT NULL,
    "modReasonId" TEXT,
    "split" BOOLEAN NOT NULL DEFAULT false,
    "bonusRateCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "voided" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedById" TEXT,
    "voidedAt" TIMESTAMP(3),

    CONSTRAINT "ManufacturingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingPay" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "ManufacturingPay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_code_key" ON "Employee"("code");

-- CreateIndex
CREATE INDEX "Employee_active_idx" ON "Employee"("active");

-- CreateIndex
CREATE UNIQUE INDEX "BaseStyle_code_key" ON "BaseStyle"("code");

-- CreateIndex
CREATE INDEX "BonusRate_baseStyleId_idx" ON "BonusRate"("baseStyleId");

-- CreateIndex
CREATE UNIQUE INDEX "BonusRate_baseStyleId_stage_key" ON "BonusRate"("baseStyleId", "stage");

-- CreateIndex
CREATE INDEX "BomComponent_productId_idx" ON "BomComponent"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "BomComponent_productId_componentId_key" ON "BomComponent"("productId", "componentId");

-- CreateIndex
CREATE INDEX "ManufacturingEntry_createdAt_idx" ON "ManufacturingEntry"("createdAt");

-- CreateIndex
CREATE INDEX "ManufacturingEntry_stage_idx" ON "ManufacturingEntry"("stage");

-- CreateIndex
CREATE INDEX "ManufacturingEntry_kind_idx" ON "ManufacturingEntry"("kind");

-- CreateIndex
CREATE INDEX "ManufacturingPay_entryId_idx" ON "ManufacturingPay"("entryId");

-- CreateIndex
CREATE INDEX "ManufacturingPay_employeeId_idx" ON "ManufacturingPay"("employeeId");

-- CreateIndex
CREATE INDEX "InventoryLedger_manufacturingEntryId_idx" ON "InventoryLedger"("manufacturingEntryId");

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_manufacturingEntryId_fkey" FOREIGN KEY ("manufacturingEntryId") REFERENCES "ManufacturingEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonusRate" ADD CONSTRAINT "BonusRate_baseStyleId_fkey" FOREIGN KEY ("baseStyleId") REFERENCES "BaseStyle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomComponent" ADD CONSTRAINT "BomComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BomComponent" ADD CONSTRAINT "BomComponent_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingEntry" ADD CONSTRAINT "ManufacturingEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingEntry" ADD CONSTRAINT "ManufacturingEntry_newProductId_fkey" FOREIGN KEY ("newProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingEntry" ADD CONSTRAINT "ManufacturingEntry_baseStyleId_fkey" FOREIGN KEY ("baseStyleId") REFERENCES "BaseStyle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingEntry" ADD CONSTRAINT "ManufacturingEntry_modReasonId_fkey" FOREIGN KEY ("modReasonId") REFERENCES "ModReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingEntry" ADD CONSTRAINT "ManufacturingEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingEntry" ADD CONSTRAINT "ManufacturingEntry_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingPay" ADD CONSTRAINT "ManufacturingPay_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ManufacturingEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingPay" ADD CONSTRAINT "ManufacturingPay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

