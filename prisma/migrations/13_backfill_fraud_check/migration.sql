-- Backfill the fraud-check flag on orders entered before the column existed.
--
-- The flag is derived: an order billed to one address and delivered to another
-- gets a manual check. Orders taken before 12_order_payments_and_flags defaulted
-- to NOT_REQUIRED, so any that qualify would silently skip the check.
--
-- The normalisation here mirrors billingDiffersFromDelivery() in
-- lib/order-payments.ts: lower-case, punctuation to spaces, collapse runs of
-- whitespace, trim. A field that is blank on either side is NOT a mismatch --
-- a half-filled agreement must not manufacture a fraud flag.

WITH normalized AS (
    SELECT
        "id",
        btrim(regexp_replace(regexp_replace(lower(coalesce("billingAddress", '')),  '[.,#]', ' ', 'g'), '\s+', ' ', 'g')) AS b_addr,
        btrim(regexp_replace(regexp_replace(lower(coalesce("deliveryAddress", '')), '[.,#]', ' ', 'g'), '\s+', ' ', 'g')) AS d_addr,
        btrim(regexp_replace(regexp_replace(lower(coalesce("billingCity", '')),     '[.,#]', ' ', 'g'), '\s+', ' ', 'g')) AS b_city,
        btrim(regexp_replace(regexp_replace(lower(coalesce("deliveryCity", '')),    '[.,#]', ' ', 'g'), '\s+', ' ', 'g')) AS d_city,
        btrim(regexp_replace(regexp_replace(lower(coalesce("billingState", '')),    '[.,#]', ' ', 'g'), '\s+', ' ', 'g')) AS b_state,
        btrim(regexp_replace(regexp_replace(lower(coalesce("deliveryState", '')),   '[.,#]', ' ', 'g'), '\s+', ' ', 'g')) AS d_state,
        btrim(regexp_replace(regexp_replace(lower(coalesce("billingZip", '')),      '[.,#]', ' ', 'g'), '\s+', ' ', 'g')) AS b_zip,
        btrim(regexp_replace(regexp_replace(lower(coalesce("deliveryZip", '')),     '[.,#]', ' ', 'g'), '\s+', ' ', 'g')) AS d_zip
    FROM "Order"
    WHERE "fraudCheckStatus" = 'NOT_REQUIRED'
)
UPDATE "Order" o
SET "fraudCheckStatus" = 'REQUIRED'
FROM normalized n
WHERE o."id" = n."id"
  AND (
        (n.b_addr  <> '' AND n.d_addr  <> '' AND n.b_addr  <> n.d_addr)
     OR (n.b_city  <> '' AND n.d_city  <> '' AND n.b_city  <> n.d_city)
     OR (n.b_state <> '' AND n.d_state <> '' AND n.b_state <> n.d_state)
     OR (n.b_zip   <> '' AND n.d_zip   <> '' AND n.b_zip   <> n.d_zip)
  );
