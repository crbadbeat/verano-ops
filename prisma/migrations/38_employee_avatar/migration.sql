-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "avatar" BYTEA,
ADD COLUMN     "avatarMime" TEXT,
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3);

