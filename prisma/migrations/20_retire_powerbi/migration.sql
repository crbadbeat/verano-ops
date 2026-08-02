-- Retire Power BI. Drop the trip-snapshot pick-sheet pipeline and the pushed-token
-- store, and rename the PickAlias source columns off their old Power BI names. The
-- hub-native pick/stage/QC/driver-sign-off flow and the PickAlias learning loop now
-- replace everything Power BI used to do.
--
-- Note: the PickAlias columns are RENAMED, not dropped+added. A drop+add would lose
-- the existing alias rows and would fail the NOT NULL add on a non-empty table; a
-- rename preserves both the data and the NOT NULL constraint. All FKs and the index
-- on tripSnapshotId are dropped before the column and its table.

-- DropForeignKey
ALTER TABLE "InventoryLedger" DROP CONSTRAINT "InventoryLedger_tripSnapshotId_fkey";

-- DropForeignKey
ALTER TABLE "TripSnapshot" DROP CONSTRAINT "TripSnapshot_fetchedById_fkey";

-- DropForeignKey
ALTER TABLE "TripSnapshot" DROP CONSTRAINT "TripSnapshot_qcById_fkey";

-- DropForeignKey
ALTER TABLE "TripSnapshotLine" DROP CONSTRAINT "TripSnapshotLine_snapshotId_fkey";

-- DropForeignKey
ALTER TABLE "TripSnapshotLine" DROP CONSTRAINT "TripSnapshotLine_productId_fkey";

-- DropIndex
DROP INDEX "InventoryLedger_tripSnapshotId_idx";

-- RenameColumn (preserves the existing scan-alias rows and the NOT NULL constraint)
ALTER TABLE "PickAlias" RENAME COLUMN "powerBiItem" TO "sourceItem";
ALTER TABLE "PickAlias" RENAME COLUMN "powerBiDetail" TO "sourceDetail";

-- AlterTable
ALTER TABLE "InventoryLedger" DROP COLUMN "tripSnapshotId";

-- DropTable
DROP TABLE "TripSnapshot";

-- DropTable
DROP TABLE "PowerBiToken";

-- DropTable
DROP TABLE "TripSnapshotLine";

-- DropEnum
DROP TYPE "SnapshotStatus";
