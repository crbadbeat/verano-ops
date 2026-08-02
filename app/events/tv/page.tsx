import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { getActiveShows, getShowAnalytics, type RepStat } from "@/lib/reporting/shows";
import { presetRange } from "@/lib/reporting/range";
import TvDashboard, { type TvShow, type TvSale, type TvLeader } from "@/components/events/TvDashboard";

export const dynamic = "force-dynamic";

// Clock read kept out of the component render (server components stay pure).
function nowDate(): Date {
  return new Date();
}

export default async function TvDashboardPage() {
  const me = await getViewer();
  if (!can(me, "events:view")) notFound();

  const now = nowDate();
  // The wall board previews shows that start up to a day out — getActiveShows opens
  // its window one day before a show's start. But presetRange("ytd").toExclusive is
  // the midnight after today, and the leader rollup needs startDate < toExclusive, so
  // a show starting *tomorrow* (already on the board) sits exactly on the excluded
  // edge and its leader silently drops from the footer while their card is on screen.
  // Widen the leader window by that one look-ahead day so it covers every show the
  // board can display. (getShowAnalytics only reads from/toExclusive off the range.)
  const ytdRange = presetRange("ytd", now);
  const leaderRange = { ...ytdRange, toExclusive: new Date(ytdRange.toExclusive.getTime() + 86_400_000) };
  const [{ shows, totals }, ytd, withAvatar] = await Promise.all([
    getActiveShows(now), // sorted %-to-goal desc
    getShowAnalytics(leaderRange),
    prisma.employee.findMany({ where: { avatarUpdatedAt: { not: null } }, select: { id: true, avatarUpdatedAt: true } }),
  ]);

  // employeeId → avatar cache-bust version (ms), for the wall avatars.
  const avatars: Record<string, number> = {};
  for (const e of withAvatar) if (e.avatarUpdatedAt) avatars[e.id] = e.avatarUpdatedAt.getTime();

  // Cross-show rep leaderboard.
  const repMap = new Map<string, RepStat>();
  for (const s of shows) {
    for (const r of s.reps) {
      const cur = repMap.get(r.repId) ?? { repId: r.repId, repName: r.repName, count: 0, salesCents: 0, aovCents: 0 };
      cur.count += r.count;
      cur.salesCents += r.salesCents;
      repMap.set(r.repId, cur);
    }
  }
  const reps = [...repMap.values()]
    .map((r) => ({ repId: r.repId, repName: r.repName, salesCents: r.salesCents, count: r.count }))
    .sort((a, b) => b.salesCents - a.salesCents);

  // Latest-sales feed + biggest sale of the day, across every active show.
  const allSales = shows.flatMap((s) =>
    s.sales.map((sale) => ({
      id: sale.id,
      repId: sale.repId,
      repName: sale.repName,
      showLabel: s.shortName?.trim() || s.name,
      location: [s.city, s.state].filter(Boolean).join(", ") || null,
      product: sale.product,
      customer: sale.customer,
      amountCents: sale.amountCents,
      createdAt: sale.createdAt,
    }))
  );
  // Newest first, by when the sale was logged.
  const latest: TvSale[] = allSales
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 8);
  const biggest: TvSale | null = allSales.reduce<TvSale | null>(
    (best, s) => (!best || s.amountCents > best.amountCents ? s : best),
    null
  );

  const tvShows: TvShow[] = shows.map((s) => ({
    showId: s.showId,
    name: s.name,
    shortName: s.shortName,
    leaderName: s.leaderName,
    city: s.city,
    state: s.state,
    status: s.status,
    salesCents: s.salesCents,
    goalCents: s.goalCents,
    pctToGoal: s.pctToGoal,
    count: s.count,
    pace: s.pace ?? null,
    spark: s.spark ?? [],
    topRep: s.reps[0] ? { repId: s.reps[0].repId, name: s.reps[0].repName, salesCents: s.reps[0].salesCents, count: s.reps[0].count } : null,
    sales: s.sales.slice(0, 8).map((sale) => ({ id: sale.id, repId: sale.repId, repName: sale.repName, customer: sale.customer, product: sale.product, amountCents: sale.amountCents })),
    weather: s.weather ? { tempF: s.weather.tempF, emoji: s.weather.emoji, label: s.weather.label } : null,
  }));

  const ytdLeaders: TvLeader[] = ytd.leaderCards
    .filter((l) => l.leaderId !== "__none__")
    .slice(0, 12)
    .map((l) => ({ leaderId: l.leaderId, name: l.leaderName, pctToGoal: l.pctToGoal, salesCents: l.salesCents }));

  return (
    <TvDashboard
      shows={tvShows}
      reps={reps}
      latest={latest}
      biggest={biggest}
      ytdLeaders={ytdLeaders}
      avatars={avatars}
      totalSalesCents={totals.salesCents}
      goalCents={totals.goalCents}
      pctToGoal={totals.pctToGoal}
      ordersCount={totals.count}
    />
  );
}
