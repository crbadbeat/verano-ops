// Maps a row of the Base / Glass lookup sheets onto the classification fields we
// store on Product. Enrichment only: these sheets are catalogues of every build
// that is *possible*, not a list of what exists, so an unmatched row is reported
// and skipped — we never create a product just because it appears in the sheet.
//
// The sheets' own decomposition columns (Grill Hole / Burner / Tiki / …) are NOT
// used: they are produced by a fixed-width split that mangles BLANK SKUs exactly
// the way our old grammar did (Burner="BL", Tiki="A", Umbrella="K"). Attributes
// come from the grammar instead; only the classification columns are read here.
//
// Pure logic only — no DB imports — so it is Vitest-testable (product-import.test.ts).

export type BuildCategoryValue = "SPECIAL" | "PARENT" | "CHILD";

export interface ClassificationRow {
  sku: string;
  buildCategory: BuildCategoryValue | null;
  parentSku: string | null;
  maxStockLevel: number | null;
  /** Why a value was dropped, for the import report. */
  notes: string[];
}

/** Column names we accept for each field, in preference order. */
export const CLASSIFICATION_COLUMNS = {
  sku: ["SKU", "Item", "Item Name", "NetSuite Name"],
  buildCategory: ["Base Category", "Build Category"],
  parent: ["Build Item", "Parent", "Parent SKU"],
  maxStock: ["Max Capacity", "Max Stock", "Max Stock Level"],
} as const;

/**
 * Non-SKU values that turn up in the Parent column. `Do Not Replenish` is a
 * replenishment instruction the sheet's author parked there; it is not a SKU and
 * must never be stored as a parent link.
 */
export function isSentinelParent(raw: string): boolean {
  const v = raw.trim();
  if (!v) return true;
  // Every real SKU is a single token of A-Z, 0-9 and dashes.
  return /\s/.test(v) || !/^[A-Za-z0-9-]+$/.test(v);
}

export function normalizeBuildCategory(raw: string): BuildCategoryValue | null {
  switch (raw.trim().toLowerCase()) {
    case "special":
      return "SPECIAL";
    case "parent":
      return "PARENT";
    case "child":
      return "CHILD";
    default:
      return null;
  }
}

function parseMaxStock(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(/[, ]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Read one sheet row into the fields we store.
 *
 * A SKU that is its own parent is left as-is rather than nulled: that is how the
 * sheets say "stocked in its own right", and callers distinguish a real cut-from
 * source with `parentSku !== sku`.
 */
export function classificationFromRow(
  row: Record<string, string>,
  cols: { sku: string; buildCategory: string | null; parent: string | null; maxStock: string | null }
): ClassificationRow | null {
  const sku = (row[cols.sku] ?? "").trim();
  if (!sku) return null;

  const notes: string[] = [];

  let buildCategory: BuildCategoryValue | null = null;
  if (cols.buildCategory) {
    const raw = (row[cols.buildCategory] ?? "").trim();
    if (raw) {
      buildCategory = normalizeBuildCategory(raw);
      if (!buildCategory) notes.push(`unrecognised category "${raw}"`);
    }
  }

  let parentSku: string | null = null;
  if (cols.parent) {
    const raw = (row[cols.parent] ?? "").trim();
    if (raw && isSentinelParent(raw)) {
      notes.push(`parent "${raw}" is not a SKU — not stored`);
    } else if (raw) {
      parentSku = raw;
    }
  }

  const maxStockLevel = cols.maxStock ? parseMaxStock(row[cols.maxStock] ?? "") : null;

  return { sku, buildCategory, parentSku, maxStockLevel, notes };
}

export interface ImportSummary {
  /** Products whose classification changed. */
  updated: number;
  /** Rows that matched a product but had nothing new to say. */
  unchanged: number;
  /** Rows with no product — deliberately NOT created. */
  noProduct: number;
  /** Rows carrying a parent that is not itself a product. */
  danglingParents: string[];
  /** Per-row remarks worth showing the user. */
  notes: string[];
}

/** True when a row would actually change what we hold for that product. */
export function isChanged(
  row: ClassificationRow,
  current: {
    parentSku: string | null;
    buildCategory: string | null;
    maxStockLevel: number | null;
  }
): boolean {
  // A sheet that omits a column must not wipe a value another sheet set.
  if (row.buildCategory !== null && row.buildCategory !== current.buildCategory) return true;
  if (row.parentSku !== null && row.parentSku !== current.parentSku) return true;
  if (row.maxStockLevel !== null && row.maxStockLevel !== current.maxStockLevel) return true;
  return false;
}
