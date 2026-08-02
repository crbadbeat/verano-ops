-- Scheduling, section 1: CSRs build delivery trips and schedule confirmed orders
-- onto them by load date. A whole order goes on ONE trip (Order.deliveryTripId);
-- the trip owns the load date and, once finalized, drops to the warehouse.
--
-- Named DeliveryTrip to stay clear of TripSnapshot (the Power BI pick-sheet
-- freeze that drives today's shipment decrements). No inventory moves here — this
-- section is upstream planning only; depletion comes at driver sign-off later.
--
-- Additive only.

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNING', 'FINALIZED', 'CANCELLED', 'STAGING', 'STAGED', 'QC_PASSED', 'LOADED', 'DELIVERED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryTripId" TEXT;

-- CreateTable
CREATE TABLE "DeliveryTrip" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "type" "OrderType" NOT NULL DEFAULT 'CUSTOMER_DELIVERY',
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNING',
    "loadDate" DATE NOT NULL,
    "area" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryTrip_loadDate_idx" ON "DeliveryTrip"("loadDate");

-- CreateIndex
CREATE INDEX "DeliveryTrip_status_idx" ON "DeliveryTrip"("status");

-- CreateIndex
CREATE INDEX "Order_deliveryTripId_idx" ON "Order"("deliveryTripId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryTripId_fkey" FOREIGN KEY ("deliveryTripId") REFERENCES "DeliveryTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
