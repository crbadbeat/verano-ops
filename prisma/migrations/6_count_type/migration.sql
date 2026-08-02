-- CreateEnum
CREATE TYPE "CountType" AS ENUM ('FULL', 'CYCLE');

-- AlterTable
ALTER TABLE "CountSession" ADD COLUMN     "type" "CountType" NOT NULL DEFAULT 'FULL';
