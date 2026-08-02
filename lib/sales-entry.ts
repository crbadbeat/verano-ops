// -----------------------------------------------------------------------------
// PGI sales-entry option lists + parsing (PURE — no DB, client-importable, unit
// tested). Mirrors the PGD "Leaderboard Submission" Power App, swapping
// Region/Showroom for Show/Show-leader.
//
// Values + enable rules below are transcribed from the Power App source
// (LeaderboardSubmissions .msapp → Screen1.pa.yaml). This is the single file to
// edit; values are stored as text on SalesEntry so changes never need a migration.
// ⚠ PRICE_LISTS is the one exception — in the Power App it is bound to a SharePoint
// list (`=PriceLists`), so those values live in SharePoint. Update the list below
// once the user supplies the actual price lists.
// -----------------------------------------------------------------------------

export const DEAL_TYPES = ["New Deal", "Upgrade/Add On"] as const;

// The standard sale types (shown when Deal Type = "New Deal"). When Deal Type is
// "Upgrade/Add On" the Power App forces Sale Type to UPGRADE_SALE_TYPE.
export const SALE_TYPES = [
  "Appliance Only",
  "Grill Island",
  "Island Bar",
  "Island Combo",
  "Shades of Verano",
] as const;
export const UPGRADE_SALE_TYPE = "Upgrade/Add On";
/** Every accepted sale-type value (for server-side validation). */
export const ALL_SALE_TYPES: readonly string[] = [...SALE_TYPES, UPGRADE_SALE_TYPE];

// Price List options are ADMIN-MANAGED (the PriceList table / /admin/price-lists),
// not hardcoded — the sales-entry form receives them as a prop. See lib/sales-entry-data.

// 1st island (Grill Island) options.
export const GRILL_ISLANDS = ["GX03", "GX04", "GX05", "GX06", "GX08", "GX09", "GX10", "GX12", "GX14"] as const;
// 2nd island (Island Bar) options.
export const ISLAND_BARS = [
  "Aruba 6", "Aruba 8", "Maui 8", "Maui 10", "Maui 12", "Maui 14",
  "Portofino 7", "Portofino 9", "St. Croix 8", "St. Croix 9", "St. Thomas 7", "St. Thomas 9",
] as const;
// 3rd island (Additional Island) options: Fire Pit + every 1st/2nd island model.
export const ADDITIONAL_ISLANDS = ["Fire Pit", ...GRILL_ISLANDS, ...ISLAND_BARS] as const;
export const SHADES_OF_VERANO = [
  "Abaco 16x16", "Abaco 16x18", "Monaco", "Mykonos", "Portofino", "St. Barths", "Tahiti",
] as const;

// Which Sale Type enables which island / shades picker (from the Power App
// DisplayMode rules). A field is editable only when its sale type is selected.
export const ENABLE_GRILL_ISLAND: readonly string[] = ["Grill Island", "Island Combo"];
export const ENABLE_ISLAND_BAR: readonly string[] = ["Island Bar", "Island Combo"];
export const ENABLE_ADDITIONAL_ISLAND: readonly string[] = ["Island Combo", "Shades of Verano"];
export const ENABLE_SHADES: readonly string[] = ["Shades of Verano"];

/**
 * Parse a currency-ish string ("$1,234.56", "1234", "1,000") into integer cents.
 * Returns null for empty/invalid input. Money is Int cents everywhere in the app.
 */
export function parseCents(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** True if `value` is one of `allowed` (used to validate a submitted dropdown). */
export function isOneOf(value: string, allowed: readonly string[]): boolean {
  return allowed.includes(value);
}

/**
 * A one-line "what sold" label for a sales entry. For a Shades of Verano sale
 * just the shade name reads best; otherwise the island model(s) chosen.
 */
export function productSummary(e: {
  saleType: string;
  grillIsland: string | null;
  islandBar: string | null;
  additionalIsland: string | null;
  shadesOfVerano: string | null;
}): string {
  if (e.saleType === "Shades of Verano") return e.shadesOfVerano || "Shades of Verano";
  const parts = [e.grillIsland, e.islandBar, e.additionalIsland].filter(Boolean);
  return parts.length ? parts.join(" + ") : e.saleType;
}
