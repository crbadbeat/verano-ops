-- CreateEnum
CREATE TYPE "ShowEventStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShowCostType" AS ENUM ('BOOTH', 'ELECTRICITY', 'INTERNET', 'SETUP', 'TRAVEL', 'LODGING', 'FLIGHTS', 'PERDIEM', 'FREIGHT', 'MARKETING', 'OTHER');

-- CreateTable
CREATE TABLE "Promoter" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowSeries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowEvent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ShowEventStatus" NOT NULL DEFAULT 'PLANNED',
    "seriesId" TEXT,
    "promoterId" TEXT,
    "venueName" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "boothNumber" TEXT,
    "boothSize" TEXT,
    "goalCents" INTEGER,
    "leadCount" INTEGER,
    "leaderEmployeeId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "ShowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowEventDate" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "label" TEXT,

    CONSTRAINT "ShowEventDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowEventCost" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" "ShowCostType" NOT NULL,
    "label" TEXT,
    "budgetCents" INTEGER,
    "actualCents" INTEGER,
    "dueDate" DATE,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowEventCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowEventStaff" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowEventStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowEventShift" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "note" TEXT,

    CONSTRAINT "ShowEventShift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Promoter_name_key" ON "Promoter"("name");

-- CreateIndex
CREATE INDEX "Promoter_active_idx" ON "Promoter"("active");

-- CreateIndex
CREATE UNIQUE INDEX "ShowSeries_name_key" ON "ShowSeries"("name");

-- CreateIndex
CREATE INDEX "ShowSeries_active_idx" ON "ShowSeries"("active");

-- CreateIndex
CREATE INDEX "ShowEvent_status_idx" ON "ShowEvent"("status");

-- CreateIndex
CREATE INDEX "ShowEvent_seriesId_idx" ON "ShowEvent"("seriesId");

-- CreateIndex
CREATE INDEX "ShowEvent_leaderEmployeeId_idx" ON "ShowEvent"("leaderEmployeeId");

-- CreateIndex
CREATE INDEX "ShowEventDate_eventId_idx" ON "ShowEventDate"("eventId");

-- CreateIndex
CREATE INDEX "ShowEventCost_eventId_idx" ON "ShowEventCost"("eventId");

-- CreateIndex
CREATE INDEX "ShowEventStaff_eventId_idx" ON "ShowEventStaff"("eventId");

-- CreateIndex
CREATE INDEX "ShowEventStaff_employeeId_idx" ON "ShowEventStaff"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ShowEventStaff_eventId_employeeId_key" ON "ShowEventStaff"("eventId", "employeeId");

-- CreateIndex
CREATE INDEX "ShowEventShift_eventId_date_idx" ON "ShowEventShift"("eventId", "date");

-- CreateIndex
CREATE INDEX "ShowEventShift_employeeId_idx" ON "ShowEventShift"("employeeId");

-- AddForeignKey
ALTER TABLE "ShowEvent" ADD CONSTRAINT "ShowEvent_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "ShowSeries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEvent" ADD CONSTRAINT "ShowEvent_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "Promoter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEvent" ADD CONSTRAINT "ShowEvent_leaderEmployeeId_fkey" FOREIGN KEY ("leaderEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEvent" ADD CONSTRAINT "ShowEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEventDate" ADD CONSTRAINT "ShowEventDate_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShowEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEventCost" ADD CONSTRAINT "ShowEventCost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShowEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEventStaff" ADD CONSTRAINT "ShowEventStaff_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShowEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEventStaff" ADD CONSTRAINT "ShowEventStaff_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEventShift" ADD CONSTRAINT "ShowEventShift_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ShowEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowEventShift" ADD CONSTRAINT "ShowEventShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

