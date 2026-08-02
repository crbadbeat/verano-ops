-- First-class employee system: grow the payroll-only Employee into the company
-- person record (identity, org chart, division membership + ids, pay, optional
-- login), add dated org history (EmployeeAssignment) and PGD Regions. Additive.

-- CreateEnum
CREATE TYPE "SalesLevel" AS ENUM ('REP', 'GTL', 'REGIONAL', 'VP');

-- CreateEnum
CREATE TYPE "SeparationType" AS ENUM ('TERMINATED', 'QUIT_WITH_NOTICE', 'QUIT_NO_NOTICE');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "regionId" TEXT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "adpId" TEXT,
ADD COLUMN     "annualSalaryCents" INTEGER,
ADD COLUMN     "cell" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "endDate" DATE,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "hireDate" DATE,
ADD COLUMN     "homeLocationId" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "payClass" TEXT,
ADD COLUMN     "payRateCents" INTEGER,
ADD COLUMN     "payStructure" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "primaryId" TEXT,
ADD COLUMN     "regionId" TEXT,
ADD COLUMN     "salesLevel" "SalesLevel",
ADD COLUMN     "separationType" "SeparationType",
ADD COLUMN     "supervisorName" TEXT,
ADD COLUMN     "title" TEXT,
-- Existing payroll Employee rows have no updatedAt; default the backfill to now so
-- the NOT NULL add succeeds. Prisma's @updatedAt manages the value from here on.
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userId" TEXT;

-- CreateTable
CREATE TABLE "EmployeeDivision" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "division" "Division" NOT NULL,
    "divisionCode" TEXT,
    "netsuiteId" TEXT,
    "effectiveDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDivision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeAssignment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "salesLevel" "SalesLevel",
    "homeLocationId" TEXT,
    "managerId" TEXT,
    "regionId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "EmployeeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "regionalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDivision_divisionCode_key" ON "EmployeeDivision"("divisionCode");

-- CreateIndex
CREATE INDEX "EmployeeDivision_employeeId_idx" ON "EmployeeDivision"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDivision_netsuiteId_idx" ON "EmployeeDivision"("netsuiteId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDivision_employeeId_division_key" ON "EmployeeDivision"("employeeId", "division");

-- CreateIndex
CREATE INDEX "EmployeeAssignment_employeeId_effectiveDate_idx" ON "EmployeeAssignment"("employeeId", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE INDEX "Region_regionalId_idx" ON "Region"("regionalId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_adpId_key" ON "Employee"("adpId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_email_key" ON "Employee"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_managerId_idx" ON "Employee"("managerId");

-- CreateIndex
CREATE INDEX "Employee_regionId_idx" ON "Employee"("regionId");

-- CreateIndex
CREATE INDEX "Employee_salesLevel_idx" ON "Employee"("salesLevel");

-- CreateIndex
CREATE INDEX "Employee_primaryId_idx" ON "Employee"("primaryId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_primaryId_fkey" FOREIGN KEY ("primaryId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_homeLocationId_fkey" FOREIGN KEY ("homeLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDivision" ADD CONSTRAINT "EmployeeDivision_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_homeLocationId_fkey" FOREIGN KEY ("homeLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeAssignment" ADD CONSTRAINT "EmployeeAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_regionalId_fkey" FOREIGN KEY ("regionalId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

