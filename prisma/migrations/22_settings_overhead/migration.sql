-- Landed-cost overhead setting. Additive only:
--   • Location.overheadExempt — warehouses that value stock at the raw NetSuite
--     average (no overhead added); default false so overhead applies everywhere.
--   • Setting — singleton config row (id "current"); overheadBps is the overhead
--     in basis points (default 1180 = 11.80%).

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "overheadExempt" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Setting" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "overheadBps" INTEGER NOT NULL DEFAULT 1180,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);
