-- ConfigOption: an option adds LINES, not a single product.
--
-- A pergola explodes into ~20 parts, a Tatta stool is a stool plus a cushion,
-- and a fridge-with-trim-kit is two physical items. A single productId cannot
-- say that. Lines are stored as `[{ label, qty }]` and resolved at derive time
-- (product master, then PickAlias, then "unmatched") because only 3 of the 29
-- shade-kit part names exist as products today.
--
-- Safe to drop the columns: this table was created empty in 10_orders and has
-- never held a row.

-- DropForeignKey
ALTER TABLE "ConfigOption" DROP CONSTRAINT "ConfigOption_productId_fkey";

-- AlterTable
ALTER TABLE "ConfigOption" DROP COLUMN "productId",
DROP COLUMN "qty",
ADD COLUMN     "lines" JSONB;
