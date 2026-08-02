-- ConfigOption now carries a FLAG, not a definition.
--
-- The built-in tables in lib/configurator-catalogue.ts always decide what an
-- option means. A stored row can only switch a built-in option off, or add an
-- option that does not exist in code yet.
--
-- It used to be the other way round, and that silently broke three separate code
-- changes: the row in the database won, so editing an option in code did nothing
-- until someone remembered to refresh the copy. Nothing is lost by inverting it —
-- correcting how an item maps to a product is handled by PickAlias, which is
-- taught by mapping a line on an order and remembered from then on.
--
-- The rows seeded under the old design are full definitions that no longer mean
-- anything. They were all active, so deleting them changes no behaviour; leaving
-- them would just make the catalogue screen look like they were in charge.

DELETE FROM "ConfigOption" WHERE "active" = true;
