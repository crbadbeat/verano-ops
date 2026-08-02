// Bin codes carry their own structure: `Aisle-Bay[-Level]`.
//
//   10-A-2            aisle 10, bay A, level 2
//   10-Floor          aisle 10, bay Floor, level 1  (stacked in the aisle, not racked)
//   7-End Cap         aisle 7,  bay End Cap, level 1
//   Crate City-Floor  a named open area, same shape
//
// The code stays the canonical identity — it is what gets displayed, printed on
// a label and scanned. Aisle / bay / level are broken out alongside it purely so
// we can filter and report, e.g. cycle count a whole aisle. A code that omits
// the level is level 1: those positions are on the ground and only have one.
//
// Pure logic only — no DB imports — so it is Vitest-testable (location-code.test.ts).

export interface LocationParts {
  aisle: string | null;
  bay: string | null;
  level: number | null;
}

/**
 * Trim, upper-case and tidy separators. Spaces INSIDE a segment are preserved —
 * "End Cap" and "Crate City" are real segment names, so collapsing whitespace
 * into dashes would split them into extra segments and shift the whole code.
 */
export function normalizeLocationCode(v: string): string {
  return v
    .trim()
    .toUpperCase()
    .replace(/\s*-\s*/g, "-") // tidy space around separators first
    .replace(/\s+/g, " ") // then collapse runs of space within a segment
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Split a bin code into its parts. Anything that isn't 2 or 3 segments (a
 * warehouse code, say) comes back all-null rather than being force-fit.
 */
export function parseLocationCode(code: string): LocationParts {
  const parts = normalizeLocationCode(code).split("-").filter(Boolean);

  if (parts.length === 3) {
    const level = Number(parts[2]);
    return {
      aisle: parts[0],
      bay: parts[1],
      level: Number.isInteger(level) && level > 0 ? level : null,
    };
  }
  if (parts.length === 2) {
    // No level segment: a ground position, of which there is only ever one.
    return { aisle: parts[0], bay: parts[1], level: 1 };
  }
  return { aisle: null, bay: null, level: null };
}

const CODED_AISLE = /^([A-Za-z]*)(\d+)$/;

/**
 * Natural order for aisles: 1, 2, … 10 … 30, then C1–C3, N1–N6, R1–R8, then the
 * named areas. Plain string sort would give 1, 10, 11, 2 — useless on a pick path.
 */
export function compareAisles(a: string, b: string): number {
  const ma = CODED_AISLE.exec(a);
  const mb = CODED_AISLE.exec(b);
  if (ma && mb) {
    if (ma[1] !== mb[1]) return ma[1].localeCompare(mb[1]);
    return Number(ma[2]) - Number(mb[2]);
  }
  if (ma) return -1; // coded aisles before named areas
  if (mb) return 1;
  return a.localeCompare(b);
}

/** Within an aisle: lettered rack bays first, then named positions, then by level. */
export function compareBins(
  a: { bay: string | null; level: number | null },
  b: { bay: string | null; level: number | null }
): number {
  const aNamed = (a.bay ?? "").length > 1;
  const bNamed = (b.bay ?? "").length > 1;
  if (aNamed !== bNamed) return aNamed ? 1 : -1;
  const bay = (a.bay ?? "").localeCompare(b.bay ?? "");
  if (bay !== 0) return bay;
  return (a.level ?? 0) - (b.level ?? 0);
}
