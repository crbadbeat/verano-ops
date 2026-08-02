import "server-only";
import { prisma } from "@/lib/db";
import { employeeName } from "@/lib/employees";
import { productSummary } from "@/lib/sales-entry";
import { formatDateSpan } from "@/lib/events";
import { eventDateRange } from "@/lib/events";
import { currentWeather, type CurrentWeather } from "@/lib/weather";
import type { DateRange } from "./range";

// -----------------------------------------------------------------------------
// Show sales analytics — self-reported PGI SalesEntry rolled up per show, per
// sales rep, and per show leader. Sales = productTotalCents (PFL fee tracked
// separately). Derive-don't-store: everything is aggregated at request time.
// -----------------------------------------------------------------------------

const DAY = 86_400_000;

export interface SaleLine {
  id: string;
  soldAt: string | null; // yyyy-mm-dd
  createdAt: string; // ISO — when the sale was logged (feed ordering + timestamp)
  repId: string;
  repName: string;
  secondRepName: string | null;
  customer: string;
  product: string; // island(s) or shade name
  saleType: string;
  priceList: string; // abbreviation if set, else the full name
  amountCents: number;
  showName: string;
}

export interface RepStat {
  repId: string;
  repName: string;
  count: number;
  salesCents: number;
  aovCents: number;
}

/** How a running show is tracking against its goal, projected linearly. */
export interface ShowPace {
  dayIndex: number; // day X (1-based) within the show's run; 0 = not started yet
  totalDays: number; // N days from first start to last end
  projectedCents: number | null; // linear end-of-show projection (null before day 1)
  onTrack: boolean | null; // projected >= goal (null when no goal / not started)
}

export interface ShowStat {
  showId: string;
  name: string;
  shortName: string | null; // compact label for the scoreboard rings
  status: string;
  city: string | null;
  state: string | null;
  leaderName: string | null;
  dateSpan: string;
  goalCents: number | null;
  salesCents: number;
  count: number;
  aovCents: number;
  pctToGoal: number | null; // e.g. 0.42 = 42%
  reps: RepStat[];
  sales: SaleLine[];
  pace?: ShowPace | null; // only set on the live "active shows" board
  spark?: number[]; // cumulative sales by show-day (for the TV sparkline)
  weather?: CurrentWeather | null; // current venue conditions (active board only)
}

/** One show a leader ran, inside a LeaderCard's "show details" list. */
export interface LeaderShowLine {
  showId: string;
  name: string;
  shortName: string | null;
  status: string;
  dateSpan: string;
  goalCents: number | null;
  salesCents: number;
  count: number;
  pctToGoal: number | null;
}

/** A show leader with their range totals + the shows they led (the Analytics
 *  "Leaders" view is built from these — leaders are the headline unit there). */
export interface LeaderCard {
  leaderId: string;
  leaderName: string;
  salesCents: number;
  goalCents: number;
  count: number; // orders
  aovCents: number;
  showCount: number;
  pctToGoal: number | null;
  shows: LeaderShowLine[]; // highest sales first
}

export interface AnalyticsTotals {
  salesCents: number;
  count: number;
  aovCents: number;
  goalCents: number;
  pctToGoal: number | null;
  showCount: number;
  leaderCount: number;
  repCount: number;
}

export interface Totals {
  salesCents: number;
  count: number;
  aovCents: number;
  goalCents: number;
  pctToGoal: number | null;
  showCount: number;
  repCount: number;
}

const aov = (cents: number, n: number) => (n > 0 ? Math.round(cents / n) : 0);
const pct = (sales: number, goal: number) => (goal > 0 ? sales / goal : null);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** name → abbreviation (falls back to name) for dense sales tables. */
async function priceListAbbrev(): Promise<Map<string, string>> {
  const rows = await prisma.priceList.findMany({ select: { name: true, abbreviation: true } });
  return new Map(rows.map((r) => [r.name, r.abbreviation?.trim() || r.name]));
}

interface RawSale {
  id: string;
  soldAt: Date | null;
  createdAt: Date;
  showEventId: string | null;
  salesRepId: string;
  salesRep: { name: string; preferredName: string | null };
  isSplitDeal: boolean;
  secondSalesRepId: string | null;
  secondSalesRep: { name: string; preferredName: string | null } | null;
  customerFirst: string;
  customerLast: string;
  saleType: string;
  grillIsland: string | null;
  islandBar: string | null;
  additionalIsland: string | null;
  shadesOfVerano: string | null;
  priceList: string;
  productTotalCents: number;
}

const SALE_SELECT = {
  id: true,
  soldAt: true,
  createdAt: true,
  showEventId: true,
  salesRepId: true,
  salesRep: { select: { name: true, preferredName: true } },
  isSplitDeal: true,
  secondSalesRepId: true,
  secondSalesRep: { select: { name: true, preferredName: true } },
  customerFirst: true,
  customerLast: true,
  saleType: true,
  grillIsland: true,
  islandBar: true,
  additionalIsland: true,
  shadesOfVerano: true,
  priceList: true,
  productTotalCents: true,
} as const;

function toLine(s: RawSale, showName: string, abbrev: Map<string, string>): SaleLine {
  return {
    id: s.id,
    soldAt: isoDay(s.soldAt),
    createdAt: s.createdAt.toISOString(),
    repId: s.salesRepId,
    repName: employeeName(s.salesRep),
    secondRepName: s.secondSalesRep ? employeeName(s.secondSalesRep) : null,
    customer: `${s.customerFirst} ${s.customerLast}`.trim(),
    product: productSummary(s),
    saleType: s.saleType,
    priceList: abbrev.get(s.priceList) ?? s.priceList,
    amountCents: s.productTotalCents,
    showName,
  };
}

/**
 * Roll a set of sale lines into per-rep stats, highest sales first. A split deal
 * credits its dollars 50/50 between the primary and second rep (odd cent goes to
 * the primary); each participating rep is counted as having worked the deal.
 */
function repStats(sales: RawSale[]): RepStat[] {
  const by = new Map<string, RepStat>();
  const credit = (id: string, name: string, cents: number) => {
    const r = by.get(id) ?? { repId: id, repName: name, count: 0, salesCents: 0, aovCents: 0 };
    r.count += 1;
    r.salesCents += cents;
    by.set(id, r);
  };
  for (const s of sales) {
    if (s.isSplitDeal && s.secondSalesRepId && s.secondSalesRep) {
      const second = Math.floor(s.productTotalCents / 2);
      credit(s.salesRepId, employeeName(s.salesRep), s.productTotalCents - second);
      credit(s.secondSalesRepId, employeeName(s.secondSalesRep), second);
    } else {
      credit(s.salesRepId, employeeName(s.salesRep), s.productTotalCents);
    }
  }
  return [...by.values()]
    .map((r) => ({ ...r, aovCents: aov(r.salesCents, r.count) }))
    .sort((a, b) => b.salesCents - a.salesCents);
}

function totalsOf(shows: ShowStat[]): Totals {
  const salesCents = shows.reduce((a, s) => a + s.salesCents, 0);
  const count = shows.reduce((a, s) => a + s.count, 0);
  const goalCents = shows.reduce((a, s) => a + (s.goalCents ?? 0), 0);
  const reps = new Set<string>();
  shows.forEach((s) => s.reps.forEach((r) => reps.add(r.repId)));
  return {
    salesCents,
    count,
    aovCents: aov(salesCents, count),
    goalCents,
    pctToGoal: pct(salesCents, goalCents),
    showCount: shows.length,
    repCount: reps.size,
  };
}

/** Build a ShowStat from a show + its sales. */
function buildShowStat(
  show: { id: string; name: string; shortName: string | null; status: string; city: string | null; state: string | null; goalCents: number | null; leaderName: string | null; dateSpan: string },
  sales: RawSale[],
  abbrev: Map<string, string>
): ShowStat {
  const salesCents = sales.reduce((a, s) => a + s.productTotalCents, 0);
  return {
    showId: show.id,
    name: show.name,
    shortName: show.shortName,
    status: show.status,
    city: show.city,
    state: show.state,
    leaderName: show.leaderName,
    dateSpan: show.dateSpan,
    goalCents: show.goalCents,
    salesCents,
    count: sales.length,
    aovCents: aov(salesCents, sales.length),
    pctToGoal: pct(salesCents, show.goalCents ?? 0),
    reps: repStats(sales),
    sales: sales
      .map((s) => toLine(s, show.name, abbrev))
      .sort((a, b) => b.amountCents - a.amountCents),
  };
}

/**
 * Where a running show sits against its goal today, projected linearly across the
 * show's run (first start → last end). `today` is UTC midnight. Before day 1 (the
 * window opens a day early) there's no projection yet; past the last day the
 * projection is just the actual.
 */
function computePace(
  dates: { startDate: Date; endDate: Date }[],
  today: Date,
  salesCents: number,
  goalCents: number | null
): ShowPace | null {
  const { first, last } = eventDateRange(dates);
  if (!first || !last) return null;
  const totalDays = Math.round((last.getTime() - first.getTime()) / DAY) + 1;
  const elapsed = Math.floor((today.getTime() - first.getTime()) / DAY) + 1; // day 1 on start
  const dayIndex = Math.max(0, Math.min(totalDays, elapsed));
  const frac = dayIndex <= 0 ? 0 : Math.min(1, dayIndex / totalDays);
  const projectedCents = frac > 0 ? Math.round(salesCents / frac) : null;
  const onTrack =
    projectedCents != null && goalCents && goalCents > 0 ? projectedCents >= goalCents : null;
  return { dayIndex, totalDays, projectedCents, onTrack };
}

/** PER-DAY sales by show-day for a show's TV bars. The x-domain is the show's run
 *  WIDENED to include every attributed sale's soldAt — so a sale logged in the
 *  −1/+3 window, or an edited date outside the span, still lands on the axis (not
 *  silently dropped). Each entry is THAT day's sales (not cumulative), so a small
 *  early sale reads as its own visible bar. UTC day buckets; capped at 62 points. */
function dailySpark(dates: { startDate: Date; endDate: Date }[], sales: RawSale[]): number[] {
  const { first, last } = eventDateRange(dates);
  const utcMidnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  let startMs = first ? utcMidnight(first) : Infinity;
  let endMs = last ? utcMidnight(last) : -Infinity;
  const byDay = new Map<string, number>();
  for (const s of sales) {
    if (!s.soldAt) continue;
    const t = utcMidnight(s.soldAt);
    startMs = Math.min(startMs, t);
    endMs = Math.max(endMs, t);
    const d = isoDay(s.soldAt)!;
    byDay.set(d, (byDay.get(d) ?? 0) + s.productTotalCents);
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];

  const days = Math.min(62, Math.round((endMs - startMs) / DAY) + 1);
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    out.push(byDay.get(isoDay(new Date(startMs + i * DAY))!) ?? 0);
  }
  return out;
}

/** Per-show self-reported sales totals (for the calendar cards + tooltip). */
export async function salesByShow(): Promise<Map<string, { salesCents: number; count: number }>> {
  const groups = await prisma.salesEntry.groupBy({
    by: ["showEventId"],
    where: { division: "PGI", showEventId: { not: null } },
    _sum: { productTotalCents: true },
    _count: { _all: true },
  });
  const map = new Map<string, { salesCents: number; count: number }>();
  for (const g of groups) {
    if (g.showEventId) map.set(g.showEventId, { salesCents: g._sum.productTotalCents ?? 0, count: g._count._all });
  }
  return map;
}

/** The shows currently in their active window (1 day before start → 3 days after
 *  end — the same window reps can log sales to), with full sales detail. */
export async function getActiveShows(now: Date): Promise<{ shows: ShowStat[]; totals: Totals }> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const openFrom = new Date(today.getTime() + DAY);
  const closeAfter = new Date(today.getTime() - 3 * DAY);

  const shows = await prisma.showEvent.findMany({
    where: {
      status: { not: "CANCELLED" },
      dates: { some: { startDate: { lte: openFrom }, endDate: { gte: closeAfter } } },
    },
    select: {
      id: true, name: true, shortName: true, status: true, city: true, state: true, goalCents: true,
      latitude: true, longitude: true,
      leader: { select: { name: true, firstName: true, lastName: true, preferredName: true } },
      dates: { select: { startDate: true, endDate: true } },
    },
  });
  if (shows.length === 0) return { shows: [], totals: totalsOf([]) };

  const [rawSales, abbrev] = await Promise.all([
    prisma.salesEntry.findMany({
      where: { division: "PGI", showEventId: { in: shows.map((s) => s.id) } },
      select: SALE_SELECT,
    }),
    priceListAbbrev(),
  ]);

  const salesByShowId = new Map<string, RawSale[]>();
  for (const s of rawSales as RawSale[]) {
    if (!s.showEventId) continue;
    (salesByShowId.get(s.showEventId) ?? salesByShowId.set(s.showEventId, []).get(s.showEventId)!).push(s);
  }

  const stats = shows
    .map((show) => {
      const range = eventDateRange(show.dates);
      const stat = buildShowStat(
        {
          id: show.id, name: show.name, shortName: show.shortName, status: show.status, city: show.city, state: show.state,
          goalCents: show.goalCents,
          leaderName: show.leader ? employeeName(show.leader) : null,
          dateSpan: range.first ? formatDateSpan(range.first, range.last!) : "No dates",
        },
        salesByShowId.get(show.id) ?? [],
        abbrev
      );
      return {
        ...stat,
        pace: computePace(show.dates, today, stat.salesCents, stat.goalCents),
        spark: dailySpark(show.dates, salesByShowId.get(show.id) ?? []),
      };
    })
    // Highest %-to-goal first (no-goal shows sink to the bottom) — so both the
    // scoreboard rings and the cards below lead with the shows that are producing.
    .sort((a, b) => (b.pctToGoal ?? -1) - (a.pctToGoal ?? -1) || b.salesCents - a.salesCents);

  // Current weather for shows with geocoded coordinates (cached ~30 min).
  const coords = shows.filter((s) => s.latitude != null && s.longitude != null);
  const wx = new Map<string, CurrentWeather | null>();
  await Promise.all(coords.map(async (s) => wx.set(s.id, await currentWeather(s.latitude!, s.longitude!))));
  const withWx = stats.map((st) => ({ ...st, weather: wx.get(st.showId) ?? null }));

  return { shows: withWx, totals: totalsOf(withWx) };
}

/** Sales in a date range (by soldAt), rolled up per show AND per show leader.
 *  Leaders are the headline unit on the Analytics page, so each leader carries
 *  every show they ran in range (0-sale shows included) with that show's goal. */
export async function getShowAnalytics(
  range: DateRange
): Promise<{ shows: ShowStat[]; leaderCards: LeaderCard[]; totals: AnalyticsTotals }> {
  const [rawSales, rangeShows, abbrev] = await Promise.all([
    prisma.salesEntry.findMany({
      where: {
        division: "PGI",
        showEventId: { not: null },
        soldAt: { gte: range.from, lt: range.toExclusive },
      },
      select: {
        ...SALE_SELECT,
        showEvent: {
          select: {
            id: true, name: true, shortName: true, status: true, city: true, state: true, goalCents: true,
            leader: { select: { id: true, name: true, firstName: true, lastName: true, preferredName: true } },
            dates: { select: { startDate: true, endDate: true } },
          },
        },
      },
    }),
    // Every show whose date span overlaps the range — the basis for the leader
    // cards, so a leader carries EVERY show they ran in range, even 0-sale ones.
    prisma.showEvent.findMany({
      where: {
        status: { not: "CANCELLED" },
        dates: { some: { startDate: { lt: range.toExclusive }, endDate: { gte: range.from } } },
      },
      select: {
        id: true, name: true, shortName: true, status: true, goalCents: true, leaderEmployeeId: true,
        leader: { select: { id: true, name: true, firstName: true, lastName: true } },
        dates: { select: { startDate: true, endDate: true } },
      },
    }),
    priceListAbbrev(),
  ]);

  type Row = RawSale & {
    showEvent: {
      id: string; name: string; shortName: string | null; status: string; city: string | null; state: string | null;
      goalCents: number | null;
      leader: { id: string; name: string; firstName: string | null; lastName: string | null; preferredName: string | null } | null;
      dates: { startDate: Date; endDate: Date }[];
    } | null;
  };
  const rows = rawSales as Row[];

  // Group sales by show.
  const byShow = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.showEvent) continue;
    (byShow.get(r.showEvent.id) ?? byShow.set(r.showEvent.id, []).get(r.showEvent.id)!).push(r);
  }
  const shows: ShowStat[] = [...byShow.values()]
    .map((rs) => {
      const ev = rs[0].showEvent!;
      const range2 = eventDateRange(ev.dates);
      return buildShowStat(
        {
          id: ev.id, name: ev.name, shortName: ev.shortName, status: ev.status, city: ev.city, state: ev.state,
          goalCents: ev.goalCents,
          leaderName: ev.leader ? employeeName(ev.leader) : null,
          dateSpan: range2.first ? formatDateSpan(range2.first, range2.last!) : "No dates",
        },
        rs,
        abbrev
      );
    })
    .sort((a, b) => b.salesCents - a.salesCents);

  // Per-show in-range sales (drives each leader's show lines).
  const showSales = new Map<string, { salesCents: number; count: number }>();
  for (const [showId, rs] of byShow) {
    showSales.set(showId, { salesCents: rs.reduce((a, s) => a + s.productTotalCents, 0), count: rs.length });
  }

  // Leader cards — grouped from every show a leader ran in range.
  const NONE = "__none__";
  const byLeader = new Map<string, { name: string; shows: LeaderShowLine[] }>();
  for (const sh of rangeShows) {
    const id = sh.leaderEmployeeId ?? NONE;
    let g = byLeader.get(id);
    if (!g) { g = { name: sh.leader ? employeeName(sh.leader) : "(no leader)", shows: [] }; byLeader.set(id, g); }
    const rng = eventDateRange(sh.dates);
    const sold = showSales.get(sh.id) ?? { salesCents: 0, count: 0 };
    g.shows.push({
      showId: sh.id,
      name: sh.name,
      shortName: sh.shortName,
      status: sh.status,
      dateSpan: rng.first ? formatDateSpan(rng.first, rng.last!) : "No dates",
      goalCents: sh.goalCents,
      salesCents: sold.salesCents,
      count: sold.count,
      pctToGoal: pct(sold.salesCents, sh.goalCents ?? 0),
    });
  }
  const leaderCards: LeaderCard[] = [...byLeader.entries()]
    .map(([leaderId, g]) => {
      const salesCents = g.shows.reduce((a, s) => a + s.salesCents, 0);
      const goalCents = g.shows.reduce((a, s) => a + (s.goalCents ?? 0), 0);
      const count = g.shows.reduce((a, s) => a + s.count, 0);
      return {
        leaderId,
        leaderName: g.name,
        salesCents,
        goalCents,
        count,
        aovCents: aov(salesCents, count),
        showCount: g.shows.length,
        pctToGoal: pct(salesCents, goalCents),
        shows: g.shows.slice().sort((a, b) => b.salesCents - a.salesCents),
      };
    })
    .sort((a, b) => (b.pctToGoal ?? -1) - (a.pctToGoal ?? -1) || b.salesCents - a.salesCents);

  // Totals — leader-centric (all shows in range).
  const salesCents = leaderCards.reduce((a, l) => a + l.salesCents, 0);
  const goalCents = leaderCards.reduce((a, l) => a + l.goalCents, 0);
  const count = leaderCards.reduce((a, l) => a + l.count, 0);
  const showCount = leaderCards.reduce((a, l) => a + l.showCount, 0);
  const reps = new Set<string>();
  shows.forEach((s) => s.reps.forEach((r) => reps.add(r.repId)));
  const totals: AnalyticsTotals = {
    salesCents,
    count,
    aovCents: aov(salesCents, count),
    goalCents,
    pctToGoal: pct(salesCents, goalCents),
    showCount,
    leaderCount: leaderCards.length,
    repCount: reps.size,
  };

  return { shows, leaderCards, totals };
}
