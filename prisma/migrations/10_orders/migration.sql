-- Orders: the hub becomes the source of truth for what a customer bought.
-- Additive only. Nothing existing changes shape.

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('POS_PDF', 'CONFIGURATOR_URL', 'MANUAL', 'LEGACY_IMPORT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED', 'SCHEDULED', 'STAGED', 'SHIPPED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('CUSTOMER_DELIVERY', 'TRANSFER', 'SHOW', 'SERVICE');

-- CreateEnum
CREATE TYPE "IslandRole" AS ENUM ('GRILL', 'BAR');

-- CreateEnum
CREATE TYPE "OrderLineOrigin" AS ENUM ('CONFIG_BASE', 'CONFIG_TOP', 'CONFIG_ITEM', 'COMBO_BOM', 'MANUAL');

-- CreateEnum
CREATE TYPE "OrderDocumentKind" AS ENUM ('ORIGINAL', 'ADDENDUM');

-- AlterEnum
-- Two values are added at once. That is only safe on PostgreSQL 12+ (Supabase is
-- well past that) and only because neither value is USED anywhere in this
-- migration -- a value added inside a transaction cannot be referenced until it
-- commits. Do not add a DEFAULT or a data row using SALES/CSR here.
ALTER TYPE "UserRole" ADD VALUE 'SALES';
ALTER TYPE "UserRole" ADD VALUE 'CSR';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "netsuiteItemId" TEXT,
ADD COLUMN     "netsuiteLinkedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "orderNo" TEXT NOT NULL,
    "posOrderNo" TEXT,
    "netsuiteOrderNo" TEXT,
    "source" "OrderSource" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "type" "OrderType" NOT NULL DEFAULT 'CUSTOMER_DELIVERY',
    "customerFirst" TEXT,
    "customerLast" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "cell" TEXT,
    "billingAddress" TEXT,
    "billingCity" TEXT,
    "billingState" TEXT,
    "billingZip" TEXT,
    "deliveryAddress" TEXT,
    "deliveryCity" TEXT,
    "deliveryState" TEXT,
    "deliveryZip" TEXT,
    "gallery" TEXT,
    "gtlId" TEXT,
    "repId" TEXT,
    "salesRepName" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "requestedTimeframe" TEXT,
    "loadDate" DATE,
    "orderTotalCents" INTEGER,
    "tradeInCreditCents" INTEGER,
    "tradeInFeeCents" INTEGER,
    "storageFeeCents" INTEGER,
    "subtotalCents" INTEGER,
    "salesTaxCents" INTEGER,
    "freightCents" INTEGER,
    "totalCents" INTEGER,
    "downPaymentCents" INTEGER,
    "balanceDueCents" INTEGER,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderIsland" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "role" "IslandRole" NOT NULL,
    "styleCode" TEXT NOT NULL,
    "grillPosition" TEXT,
    "attributes" JSONB NOT NULL,
    "baseSku" TEXT,
    "baseProductId" TEXT,
    "topSku" TEXT,
    "topProductId" TEXT,
    "topBlankSku" TEXT,

    CONSTRAINT "OrderIsland_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "islandId" TEXT,
    "origin" "OrderLineOrigin" NOT NULL DEFAULT 'MANUAL',
    "productId" TEXT,
    "sku" TEXT,
    "rawLabel" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDocument" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "OrderDocumentKind" NOT NULL DEFAULT 'ORIGINAL',
    "filename" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "parsedJson" JSONB,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigOption" (
    "id" TEXT NOT NULL,
    "param" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "aliases" TEXT[],
    "attrKey" TEXT,
    "attrValue" TEXT,
    "attrDelta" INTEGER,
    "productId" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConfigOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderNo_key" ON "Order"("orderNo");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_posOrderNo_idx" ON "Order"("posOrderNo");

-- CreateIndex
CREATE INDEX "Order_loadDate_idx" ON "Order"("loadDate");

-- CreateIndex
CREATE INDEX "Order_customerLast_idx" ON "Order"("customerLast");

-- CreateIndex
CREATE INDEX "OrderIsland_orderId_idx" ON "OrderIsland"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_productId_idx" ON "OrderLine"("productId");

-- CreateIndex
CREATE INDEX "OrderLine_islandId_idx" ON "OrderLine"("islandId");

-- CreateIndex
CREATE INDEX "OrderDocument_orderId_idx" ON "OrderDocument"("orderId");

-- CreateIndex
CREATE INDEX "OrderDocument_sha256_idx" ON "OrderDocument"("sha256");

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ConfigOption_param_idx" ON "ConfigOption"("param");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigOption_param_code_key" ON "ConfigOption"("param", "code");

-- CreateIndex
CREATE INDEX "Product_netsuiteLinkedAt_idx" ON "Product"("netsuiteLinkedAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderIsland" ADD CONSTRAINT "OrderIsland_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderIsland" ADD CONSTRAINT "OrderIsland_baseProductId_fkey" FOREIGN KEY ("baseProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderIsland" ADD CONSTRAINT "OrderIsland_topProductId_fkey" FOREIGN KEY ("topProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_islandId_fkey" FOREIGN KEY ("islandId") REFERENCES "OrderIsland"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDocument" ADD CONSTRAINT "OrderDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConfigOption" ADD CONSTRAINT "ConfigOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every product that exists before this migration came from NetSuite,
-- so mark it linked. The NetSuite match queue is exactly the products left with
-- a NULL netsuiteLinkedAt -- i.e. only ones order intake auto-creates from here on.
UPDATE "Product" SET "netsuiteLinkedAt" = CURRENT_TIMESTAMP WHERE "netsuiteLinkedAt" IS NULL;
