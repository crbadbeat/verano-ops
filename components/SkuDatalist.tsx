import { productDisplayName } from "@/lib/item-master";

// Shared <datalist> for the "map an item to a product" pickers. The option
// VALUE stays the sku — that is the key every mapping action resolves on — but
// the option LABEL is the human name, so the suggestion list shows (and filters
// by) something a person can read. Since the Item Master migration, sku is the
// NetSuite NUMBER for purchased items, and a bare number is not mappable by eye.
// The label resolves through the WMS display-name override (displayName ?? name
// ?? sku) so a curated name shows here too.
export default function SkuDatalist({
  id,
  products,
}: {
  id: string;
  products: { sku: string; name: string; displayName?: string | null }[];
}) {
  return (
    <datalist id={id}>
      {products.map((p) => (
        <option key={p.sku} value={p.sku} label={productDisplayName(p)} />
      ))}
    </datalist>
  );
}
