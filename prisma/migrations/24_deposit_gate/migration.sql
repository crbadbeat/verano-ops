-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "depositReceivedCents" INTEGER,
ADD COLUMN     "depositSyncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "minDepositBps" INTEGER NOT NULL DEFAULT 5000;
