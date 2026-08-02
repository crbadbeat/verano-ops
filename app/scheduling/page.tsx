import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { createTrip } from "./actions";
import { buildMonthGrid, shiftMonth, parseMonth, monthParam, isoDate } from "@/lib/scheduling";
import type { OrderType, TripStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TYPE_TONE: Record<OrderType, string> = {
  CUSTOMER_DELIVERY: "text-teal",
  TRANSFER: "text-ember",
  SHOW: "text-showgood",
  SERVICE: "text-muted",
};

// Trips shown on the calendar are never CANCELLED, but keep the full map so the
// chip colour is always defined.
const STATUS_DOT: Record<TripStatus, string> = {
  PLANNING: "bg-muted",
  FINALIZED: "bg-ember",
  CANCELLED: "bg-muted",
  STAGING: "bg-ember",
  STAGED: "bg-ember",
  QC_PASSED: "bg-teal",
  LOADED: "bg-teal",
  DELIVERED: "bg-success",
};

export default async function SchedulingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; new?: string }>;
}) {
  const { month, new: newDate } = await searchParams;
  const user = await getViewer();
  const canManage = can(user, "scheduling:edit");

  const now = new Date();
  const current =
    parseMonth(month) ?? { year: now.getUTCFullYear(), month0: now.getUTCMonth() };
  const weeks = buildMonthGrid(current.year, current.month0);
  const gridStart = weeks[0][0].date;
  const gridEnd = weeks[weeks.length - 1][6].date;

  const [trips, unscheduled] = await Promise.all([
    prisma.deliveryTrip.findMany({
      where: { loadDate: { gte: gridStart, lte: gridEnd }, status: { not: "CANCELLED" } },
      include: { _count: { select: { orders: true } } },
      orderBy: { loadDate: "asc" },
    }),
    prisma.order.count({ where: { status: "CONFIRMED", deliveryTripId: null } }),
  ]);

  const byDay = new Map<string, typeof trips>();
  for (const t of trips) {
    const key = isoDate(t.loadDate);
    const list = byDay.get(key) ?? [];
    list.push(t);
    byDay.set(key, list);
  }

  const prev = shiftMonth(current.year, current.month0, -1);
  const next = shiftMonth(current.year, current.month0, 1);
  const monthLabel = new Date(Date.UTC(current.year, current.month0, 1)).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
  const todayIso = isoDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())),
  );
  const thisMonthParam = monthParam(current.year, current.month0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <div className="flex items-start gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scheduling</h1>
          <p className="text-muted mt-1">
            Build delivery trips and schedule confirmed orders onto them. A finalized
            trip drops to the warehouse to be picked and staged.
          </p>
        </div>
      </div>

      {unscheduled > 0 && (
        <div className="card p-4 flex items-center gap-3 flex-wrap">
          <span className="badge text-ember">{unscheduled}</span>
          <span className="text-sm">
            confirmed {unscheduled === 1 ? "order is" : "orders are"} waiting to be
            scheduled — open a trip to add {unscheduled === 1 ? "it" : "them"}.
          </span>
        </div>
      )}

      {canManage && (
        <details className="card p-5" open={!!newDate}>
          <summary className="font-semibold cursor-pointer">New trip</summary>
          <form action={createTrip} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-muted space-y-1 block">
              <span>Load date</span>
              <input
                name="loadDate"
                type="date"
                required
                defaultValue={newDate ?? todayIso}
                className="input w-full"
              />
            </label>
            <label className="text-sm text-muted space-y-1 block">
              <span>Type</span>
              <select name="type" className="input w-full" defaultValue="CUSTOMER_DELIVERY">
                <option value="CUSTOMER_DELIVERY">Customer delivery</option>
                <option value="TRANSFER">Transfer</option>
                <option value="SHOW">Show</option>
              </select>
            </label>
            <label className="text-sm text-muted space-y-1 block">
              <span>Name (optional)</span>
              <input name="name" className="input w-full" placeholder="South FL — Fri" />
            </label>
            <label className="text-sm text-muted space-y-1 block">
              <span>Area (optional)</span>
              <input name="area" className="input w-full" placeholder="Boynton Beach" />
            </label>
            <button className="btn btn-primary sm:col-span-2" type="submit">
              Create trip
            </button>
          </form>
        </details>
      )}

      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{monthLabel}</h2>
        <div className="ml-auto flex items-center gap-1">
          <Link
            href={`/scheduling?month=${monthParam(prev.year, prev.month0)}`}
            className="btn btn-ghost py-1.5 px-3"
            aria-label="Previous month"
          >
            ←
          </Link>
          <Link href="/scheduling" className="btn btn-ghost py-1.5 px-3 text-sm">
            Today
          </Link>
          <Link
            href={`/scheduling?month=${monthParam(next.year, next.month0)}`}
            className="btn btn-ghost py-1.5 px-3"
            aria-label="Next month"
          >
            →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden border border-border">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-surface p-2 text-center text-xs text-muted font-medium">
            {d}
          </div>
        ))}
        {weeks.flat().map((cell) => {
          const dayTrips = byDay.get(cell.iso) ?? [];
          const isToday = cell.iso === todayIso;
          return (
            <div
              key={cell.iso}
              className={`bg-surface min-h-24 p-1.5 ${cell.inMonth ? "" : "opacity-40"}`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={
                    isToday
                      ? "badge text-ember text-xs"
                      : "text-xs text-muted tabular-nums"
                  }
                >
                  {cell.date.getUTCDate()}
                </span>
                {canManage && cell.inMonth && (
                  <Link
                    href={`/scheduling?month=${thisMonthParam}&new=${cell.iso}`}
                    className="text-muted hover:text-ember text-sm leading-none px-1"
                    aria-label={`New trip on ${cell.iso}`}
                  >
                    +
                  </Link>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {dayTrips.map((t) => (
                  <Link
                    key={t.id}
                    href={`/scheduling/trips/${t.id}`}
                    className="flex items-center gap-1.5 rounded bg-surface-2 px-1.5 py-1 text-xs hover:ring-1 hover:ring-border"
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[t.status]}`}
                    />
                    <span className={`font-medium truncate ${TYPE_TONE[t.type]}`}>
                      {t.name ?? t.area ?? t.type.replace("_", " ").toLowerCase()}
                    </span>
                    <span className="text-muted ml-auto tabular-nums">{t._count.orders}</span>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
