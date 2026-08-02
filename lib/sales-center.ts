import { normLocation, LOCATION_ALIASES } from "./adp";

// -----------------------------------------------------------------------------
// Map a NetSuite "sales center" (cseg_sales_center) to a WMS showroom Location.
// The segment names are the showroom + " Showroom" (e.g. "Fort Myers Showroom"),
// with a few non-showroom values ("6-Corporate FL PGD"). We strip to the bare
// showroom name and match against Location names, reusing the ADP location aliases
// (Fort→Ft., "The Woodlands"→Woodlands, …). Pure + unit-tested; the DB write of
// Location.netsuiteSalesCenterId happens in the mapping action.
// -----------------------------------------------------------------------------

/** Strip a sales-center name to a comparable showroom name, or null if it isn't
 *  a showroom (Corporate, etc.). */
export function salesCenterToShowroomName(raw: string): string | null {
  const s0 = raw.trim();
  if (/corporate/i.test(s0)) return null;
  const s = s0
    .replace(/^\d+\s*-\s*/, "") // leading "6-" style prefix
    .replace(/\s+showroom\b/i, "")
    .replace(/\s+show\s+sale.*$/i, "") // "Clermont Show Sale PGD" -> "Clermont"
    .replace(/\s+pgd\b/i, "")
    .replace(/\s+ga\b/i, "") // "Kennesaw GA" -> "Kennesaw"
    .replace(/\s+fl\b/i, "")
    .trim();
  return s || null;
}

// Sales-center-name (stripped, lowercased) → WMS Location name, for the showroom
// names that differ from ours beyond the shared ADP aliases (mall/plaza suffixes,
// word-order, etc.). A human confirms the rest on the mapping-review screen.
export const SALES_CENTER_ALIASES: Record<string, string> = {
  "pga boulevard": "PGA",
  "orlando flagship": "Orlando",
  villages: "The Villages",
  "bonita beach commons": "Bonita Commons",
  "naples on 5th avenue": "Naples",
  "fashion mall indianapolis": "Fashion Mall",
  "doral square": "Doral",
  "plantation walk": "Plantation",
  "phipps plaza buckhead": "Buckhead",
};

/** Resolve a sales-center name to a WMS Location id, or null if unmatched. */
export function matchSalesCenter(
  rawName: string,
  locations: { id: string; name: string }[]
): string | null {
  const target = salesCenterToShowroomName(rawName);
  if (!target) return null;
  const byNorm = new Map(locations.map((l) => [normLocation(l.name), l.id]));
  const key = target.toLowerCase();
  const alias = SALES_CENTER_ALIASES[key] ?? LOCATION_ALIASES[key];
  return (
    byNorm.get(normLocation(target)) ??
    (alias ? byNorm.get(normLocation(alias)) ?? null : null)
  );
}
