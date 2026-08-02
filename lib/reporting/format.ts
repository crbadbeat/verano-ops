// Shared formatters for the dashboards. Money is Int cents everywhere in the
// schema, so these take cents.

/** Full currency, no cents shown: 52340012 -> "$523,400". */
export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * Whole-dollar currency, always ROUNDED DOWN so a display never overstates
 * progress toward a goal: 123499 -> "$1,234", 99995 -> "$999" (not "$1,000").
 * Use for self-reported sales + goal figures on the shows dashboards.
 */
export function moneyFloor(cents: number): string {
  return Math.floor(cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** "42%" of goal, floored so 99.95% never reads as "100%"; "—" when no goal. */
export function pctFloor(p: number | null): string {
  return p == null ? "—" : `${Math.floor(p * 100)}%`;
}

/** Compact currency for tight tiles: 52340012 -> "$523k", 1200000000 -> "$12.0M". */
export function moneyCompact(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })}M`;
  if (abs >= 1_000) return `$${(dollars / 1_000).toLocaleString("en-US", { maximumFractionDigits: 0 })}k`;
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
