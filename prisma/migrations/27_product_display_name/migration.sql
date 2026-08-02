-- WMS-owned display-name override. The item master now syncs create-or-update
-- from NetSuite, which writes NetSuite's (often poor) name into `name` as a
-- fallback. `displayName` is the one name the app surfaces and the sync must
-- NEVER touch it. Resolver everywhere: displayName ?? name ?? sku.
--
-- Additive only.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "displayName" TEXT;

-- Backfill: preserve every curated name as the override so the first
-- create-or-update sync can't clobber it. Configured products whose `name` is
-- just their smart-SKU (name = sku) are left null, so they resolve name/sku
-- naturally and pick up a NetSuite name once matched.
UPDATE "Product" SET "displayName" = "name" WHERE "name" <> "sku";
