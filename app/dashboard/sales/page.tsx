import Link from "next/link";
import { type Division } from "@prisma/client";
import { requireDashboardUser, dashboardTabs, resolveSiteScope } from "@/lib/reporting/scope";
import { parseRange, presetRange, type DateRange } from "@/lib/reporting/range";
import {
  getSalesRollup,
  childTierOf,
  type SalesDrill,
  type SalesTier,
} from "@/lib/reporting/sales";
import { money, moneyCompact } from "@/lib/reporting/format";
import DashboardChrome from "@/components/dashboard/DashboardChrome";
import SalesRangeControl from "@/components/dashboard/SalesRangeControl";
import KpiTile from "@/components/dashboard/KpiTile";
import Leaderboard, { type LeaderRow } from "@/components/dashboard/Leaderboard";
import EmptyState from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

const CHILD_TIER_TITLE: Record<SalesTier, string> = {
  division: "By division",
  region: "By region",
  showroom: "By showroom",
  rep: "By sales rep",
};

const MIN_YEAR = 2024;

type SalesParams = {
  preset?: string;
  from?: string;
  to?: string;
  division?: string;
  region?: string;
  showroom?: string;
  rep?: string;
};

function parseDrill(sp: SalesParams): SalesDrill {
  const division: Division | null = sp.division === "PGI" || sp.division === "PGD" ? sp.division : null;
  // A drill level only takes effect if its parent is present (region needs a
  // division, showroom needs a region, rep needs a showroom).
  const regionId = division ? sp.region ?? null : null;
  const showroomId = regionId ? sp.showroom ?? null : null;
  const repId = showroomId ? sp.rep ?? null : null;
  return { division, regionId, showroomId, repId };
}

/** The range query params to carry across drill links, so the window is stable. */
function rangeParams(sp: SalesParams): Record<string, string> {
  if (sp.from && sp.to) return { from: sp.from, to: sp.to };
  return { preset: sp.preset || "ytd" };
}

function hrefFor(drill: SalesDrill, carry: Record<string, string>): string {
  const params = new URLSearchParams(carry);
  if (drill.division) params.set("division", drill.division);
  if (drill.regionId) params.set("region", drill.regionId);
  if (drill.showroomId) params.set("showroom", drill.showroomId);
  if (drill.repId) params.set("rep", drill.repId);
  const qs = params.toString();
  return qs ? `/dashboard/sales?${qs}` : "/dashboard/sales";
}

/** Extend the current drill by one tier, landing on the given child row key. */
function drillInto(drill: SalesDrill, tier: SalesTier, key: string): SalesDrill {
  switch (tier) {
    case "division":
      return { division: key as Division, regionId: null, showroomId: null, repId: null };
    case "region":
      return { ...drill, regionId: key, showroomId: null, repId: null };
    case "showroom":
      return { ...drill, showroomId: key, repId: null };
    case "rep":
      return { ...drill, repId: key };
  }
}

function rangeControlValue(range: DateRange): string {
  if (range.preset !== "custom") return range.preset;
  const y = range.fromIso.slice(0, 4);
  if (range.fromIso === `${y}-01-01` && range.toIso === `${y}-12-31`) return `y${y}`;
  return "custom";
}

export default async function SalesDashboard({
  searchParams,
}: {
  searchParams: Promise<SalesParams>;
}) {
  const user = await requireDashboardUser();
  const sp = await searchParams;
  const now = new Date();

  // Sales analytics defaults to year-to-date; the operational mtd default would
  // hide almost all of the multi-year order book.
  const range = sp.from || sp.to || sp.preset ? parseRange(sp, now) : presetRange("ytd", now);
  const scope = await resolveSiteScope("all");
  const drill = parseDrill(sp);
  const carry = rangeParams(sp);

  const rollup = await getSalesRollup(range, drill);
  const childTier = childTierOf(drill);

  const leaderRows: LeaderRow[] = rollup.rows.map((row) => {
    const canDrill = row.drillable && !(childTier === "division" && row.key !== "PGI" && row.key !== "PGD");
    const href = canDrill ? hrefFor(drillInto(drill, childTier, row.key), carry) : null;
    return {
      key: row.key,
      name: href ? (
        <Link href={href} className="hover:text-foreground hover:underline">
          {row.name} <span aria-hidden>›</span>
        </Link>
      ) : (
        row.name
      ),
      value: row.salesCents,
      valueLabel: money(row.salesCents),
      meta: `${row.orderCount.toLocaleString()} orders`,
    };
  });

  const productRows: LeaderRow[] = rollup.topProducts.map((p) => ({
    key: p.key,
    name: p.name,
    value: p.units,
    valueLabel: p.units.toLocaleString(),
  }));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <DashboardChrome
        title="Sales"
        description="Bookings across Division → Region → Showroom → Sales rep, over the full NetSuite order book."
        range={range}
        scope={scope}
        tabs={dashboardTabs(user)}
        showSite={false}
        rangeControl={
          <SalesRangeControl
            current={rangeControlValue(range)}
            minYear={MIN_YEAR}
            maxYear={now.getUTCFullYear()}
          />
        }
      />

      {/* Breadcrumb drill trail */}
      <nav aria-label="Drill path" className="flex flex-wrap items-center gap-1.5 text-sm">
        {rollup.crumbs.map((crumb, i) => {
          const last = i === rollup.crumbs.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted">/</span>}
              {last ? (
                <span className="font-semibold">{crumb.label}</span>
              ) : (
                <Link href={hrefFor(crumb.drill, carry)} className="text-muted hover:text-foreground hover:underline">
                  {crumb.label}
                </Link>
              )}
            </span>
          );
        })}
      </nav>

      {/* Scope totals */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <KpiTile
          label="Sales"
          value={money(rollup.totals.salesCents)}
          tone="teal"
          sub={rollup.trend.length ? "monthly trend below" : undefined}
          trend={rollup.trend}
          trendTone="teal"
        />
        <KpiTile label="Orders" value={rollup.totals.orderCount.toLocaleString()} />
        <KpiTile
          label="Avg order value"
          value={moneyCompact(rollup.totals.avgCents)}
          sub="sales ÷ orders"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Drill-down: the tier below the current scope */}
        {!rollup.isLeaf && (
          <section className="card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h2 className="font-semibold">{CHILD_TIER_TITLE[childTier]}</h2>
              <span className="text-xs text-muted">{rollup.rows.length} rows</span>
            </div>
            <Leaderboard rows={leaderRows} emptyMessage="No sales in this window." />
          </section>
        )}

        {/* Product mix for the current scope, from the order lines */}
        <section className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Top products</h2>
            <p className="text-xs text-muted mt-0.5">By units on the order lines</p>
          </div>
          <Leaderboard rows={productRows} unit="units" emptyMessage="No order lines in this window." />
        </section>

        {rollup.isLeaf && (
          <section className="card p-6 flex items-center">
            <EmptyState message="This is the deepest level — the rep's own bookings and product mix are shown here." />
          </section>
        )}
      </div>
    </div>
  );
}
