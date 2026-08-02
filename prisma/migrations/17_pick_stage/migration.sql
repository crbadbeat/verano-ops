-- Warehouse pick & stage (Scheduling section 2). Picking scans a source bin and
-- an item and MOVES the goods into the trip's staging lane: a -qty/+qty ledger
-- pair (reason PICK) that conserves total on-hand while updating per-location
-- inventory. The depletion out of the warehouse stays at driver sign-off.
--
-- Lanes are Location rows flagged isStagingLane (not a new LocationType, to avoid
-- the ALTER TYPE ADD VALUE / use-in-same-transaction pitfall); they are seeded
-- idempotently by ensureStagingLanes() at runtime, not here.
--
-- The new PICK reason is written only at runtime, never in this migration, so the
-- enum add is safe inside the migration transaction.
--
-- Additive only.

-- AlterEnum
ALTER TYPE "LedgerReason" ADD VALUE 'PICK';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "barcode" TEXT;

-- AlterTable
ALTER TABLE "InventoryLedger" ADD COLUMN     "tripId" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "isStagingLane" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DeliveryTrip" ADD COLUMN     "stagedAt" TIMESTAMP(3),
ADD COLUMN     "stagedById" TEXT;

-- CreateTable
CREATE TABLE "DeliveryTripLane" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "laneId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryTripLane_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "InventoryLedger_tripId_idx" ON "InventoryLedger"("tripId");

-- CreateIndex
CREATE INDEX "DeliveryTripLane_tripId_idx" ON "DeliveryTripLane"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryTripLane_tripId_laneId_key" ON "DeliveryTripLane"("tripId", "laneId");

-- AddForeignKey
ALTER TABLE "InventoryLedger" ADD CONSTRAINT "InventoryLedger_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "DeliveryTrip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_stagedById_fkey" FOREIGN KEY ("stagedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTripLane" ADD CONSTRAINT "DeliveryTripLane_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "DeliveryTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTripLane" ADD CONSTRAINT "DeliveryTripLane_laneId_fkey" FOREIGN KEY ("laneId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
