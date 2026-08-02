-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'PGI_SALES';

-- CreateTable
CREATE TABLE "SalesEntry" (
    "id" TEXT NOT NULL,
    "division" "Division" NOT NULL,
    "showEventId" TEXT,
    "showLeaderId" TEXT,
    "regionId" TEXT,
    "showroomId" TEXT,
    "salesRepId" TEXT NOT NULL,
    "isSplitDeal" BOOLEAN NOT NULL DEFAULT false,
    "secondSalesRepId" TEXT,
    "customerFirst" TEXT NOT NULL,
    "customerLast" TEXT NOT NULL,
    "dealType" TEXT NOT NULL,
    "saleType" TEXT NOT NULL,
    "priceList" TEXT NOT NULL,
    "grillIsland" TEXT,
    "islandBar" TEXT,
    "additionalIsland" TEXT,
    "shadesOfVerano" TEXT,
    "productTotalCents" INTEGER NOT NULL,
    "pflFeeCents" INTEGER,
    "matchedOrderId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesEntry_matchedOrderId_key" ON "SalesEntry"("matchedOrderId");

-- CreateIndex
CREATE INDEX "SalesEntry_division_idx" ON "SalesEntry"("division");

-- CreateIndex
CREATE INDEX "SalesEntry_showEventId_idx" ON "SalesEntry"("showEventId");

-- CreateIndex
CREATE INDEX "SalesEntry_salesRepId_idx" ON "SalesEntry"("salesRepId");

-- CreateIndex
CREATE INDEX "SalesEntry_showLeaderId_idx" ON "SalesEntry"("showLeaderId");

-- CreateIndex
CREATE INDEX "SalesEntry_soldAt_idx" ON "SalesEntry"("soldAt");

-- AddForeignKey
ALTER TABLE "SalesEntry" ADD CONSTRAINT "SalesEntry_showEventId_fkey" FOREIGN KEY ("showEventId") REFERENCES "ShowEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEntry" ADD CONSTRAINT "SalesEntry_showLeaderId_fkey" FOREIGN KEY ("showLeaderId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEntry" ADD CONSTRAINT "SalesEntry_salesRepId_fkey" FOREIGN KEY ("salesRepId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEntry" ADD CONSTRAINT "SalesEntry_secondSalesRepId_fkey" FOREIGN KEY ("secondSalesRepId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEntry" ADD CONSTRAINT "SalesEntry_matchedOrderId_fkey" FOREIGN KEY ("matchedOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesEntry" ADD CONSTRAINT "SalesEntry_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Power BI read model. A curated, read-only VIEW is the stable contract the
-- external Power BI leaderboard reads (via a read-only Postgres role) so schema
-- churn never breaks the report. Names are flattened + money is dollars. Grant
-- the read-only role SELECT on THIS view only (see the project deploy notes).
-- ---------------------------------------------------------------------------
CREATE VIEW v_sales_entries AS
SELECT
  se."id"                                            AS id,
  se."division"                                      AS division,
  se."soldAt"                                        AS sold_at,
  se."createdAt"                                     AS created_at,
  se."customerFirst"                                 AS customer_first,
  se."customerLast"                                  AS customer_last,
  rep."name"                                         AS sales_rep_name,
  rep."code"                                         AS sales_rep_code,
  se."isSplitDeal"                                   AS is_split_deal,
  rep2."name"                                        AS second_sales_rep_name,
  ev."name"                                          AS show_name,
  leader."name"                                      AS show_leader_name,
  se."dealType"                                      AS deal_type,
  se."saleType"                                      AS sale_type,
  se."priceList"                                     AS price_list,
  se."grillIsland"                                   AS grill_island,
  se."islandBar"                                     AS island_bar,
  se."additionalIsland"                              AS additional_island,
  se."shadesOfVerano"                              AS shades_of_verano,
  round(se."productTotalCents"::numeric / 100.0, 2)  AS product_total,
  round(se."pflFeeCents"::numeric / 100.0, 2)        AS pfl_fee,
  (se."matchedOrderId" IS NOT NULL)                  AS matched,
  enterer."email"                                    AS entered_by_email
FROM "SalesEntry" se
LEFT JOIN "Employee"  rep     ON rep."id"     = se."salesRepId"
LEFT JOIN "Employee"  rep2    ON rep2."id"    = se."secondSalesRepId"
LEFT JOIN "ShowEvent" ev      ON ev."id"      = se."showEventId"
LEFT JOIN "Employee"  leader  ON leader."id"  = se."showLeaderId"
LEFT JOIN "User"      enterer ON enterer."id" = se."enteredById";
