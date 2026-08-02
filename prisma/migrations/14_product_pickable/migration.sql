-- Whether the warehouse ever picks a product.
--
-- An outlet is a real product we buy and stock, but it is built into the base,
-- so it belongs ON the order and NOT on the pick list. That is a property of the
-- product, not a rule in the importer -- more of these will turn up as orders
-- are worked through, and each one should be a checkbox rather than a deploy.

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "pickable" BOOLEAN NOT NULL DEFAULT true;

-- The ones known today.
UPDATE "Product" SET "pickable" = false WHERE "sku" IN ('Outlet', 'Outlet/ Switch Combo');
