// Pure Item Master mapping (no DB) — unit-tested in lib/item-master.test.ts.
//
// The master keys on the STABLE NetSuite number. `sku` stays the working key:
// the smart-SKU for grammar items (blanks carry it in the SKU column), otherwise
// the number itself. The (mutable) NetSuite name becomes a display-only
// `description`; the display name is `name`.

export interface RawItemRow {
  number?: string;
  sku?: string;
  displayName?: string;
  description?: string;
  barcode?: string;
  category?: string;
}

export interface ItemMasterRow {
  netsuiteNumber: string;
  sku: string;
  name: string; // required display name — never empty
  description: string | null;
  barcode: string | null;
  category: string | null;
}

const clean = (v: string | undefined): string => (v ?? "").trim();

/**
 * The ONE name to show for a product, everywhere it appears. `displayName` is the
 * WMS-owned override (curated, never touched by the NetSuite sync); `name` is
 * NetSuite's own item name kept as a fallback; `sku` is the last resort so the
 * result is never empty. Pure so it is safe to call in server and client code.
 */
export function productDisplayName(p: {
  displayName?: string | null;
  name?: string | null;
  sku?: string | null;
}): string {
  return (
    (p.displayName ?? "").trim() ||
    (p.name ?? "").trim() ||
    (p.sku ?? "").trim()
  );
}

/**
 * Map one upload row to product fields, or null when it has no NetSuite number
 * (the required key). `sku` defaults to the number when no SKU is given (grammar
 * items supply their smart-SKU); `name` falls back to the description, then the
 * number, so it is never empty.
 */
export function itemMasterRow(raw: RawItemRow): ItemMasterRow | null {
  const netsuiteNumber = clean(raw.number);
  if (!netsuiteNumber) return null;

  const description = clean(raw.description) || null;
  return {
    netsuiteNumber,
    sku: clean(raw.sku) || netsuiteNumber,
    name: clean(raw.displayName) || description || netsuiteNumber,
    description,
    barcode: clean(raw.barcode) || null,
    category: clean(raw.category) || null,
  };
}
