-- Payments, commercial flags and the fraud-check flag.
--
-- The agreement PRINTS a down payment, but what we need is the money actually
-- taken AND the method it came in on: check and wire cost us nothing, a card or
-- GreenSky carries a fee, and that difference is what the rep's Paid In Full 1%
-- bonus turns on. So payments are entered, not parsed, one row each.
--
-- Additive only.

-- CreateEnum
CREATE TYPE "GasType" AS ENUM ('LP', 'NG');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CHECK', 'WIRE_TRANSFER', 'CREDIT_CARD', 'GREENSKY');

-- CreateEnum
CREATE TYPE "FraudCheckStatus" AS ENUM ('NOT_REQUIRED', 'REQUIRED', 'CLEARED', 'REJECTED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "fraudCheckNote" TEXT,
ADD COLUMN     "fraudCheckStatus" "FraudCheckStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
ADD COLUMN     "freightInTotal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "gasType" "GasType",
ADD COLUMN     "paidInFullConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "paidInFullConfirmedById" TEXT,
ADD COLUMN     "paidInFullOnePercent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "veranoForLife" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "veranoForLifeTier" TEXT,
ADD COLUMN     "taxFree" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "OrderPayment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reference" TEXT,
    "receivedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderPayment_orderId_idx" ON "OrderPayment"("orderId");

-- CreateIndex
CREATE INDEX "OrderPayment_method_idx" ON "OrderPayment"("method");

-- CreateIndex
CREATE INDEX "Order_fraudCheckStatus_idx" ON "Order"("fraudCheckStatus");

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPayment" ADD CONSTRAINT "OrderPayment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
