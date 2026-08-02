import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import {
  EVENT_STATUS_LABEL,
  eventDateRange,
  formatDateSpan,
  costTotals,
  usd,
} from "@/lib/events";
import PageHeader from "@/components/ui/PageHeader";
import { createSeries } from "../actions";

export const dynamic = "force-dynamic";

export default async function SeriesPage() {
  const me = await getViewer();
  if (!can(me, "events:edit")) notFound();

  const series = await prisma.showSeries.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      events: {
        include: {
          dates: { select: { startDate: true, endDate: true } },
          costs: { select: { budgetCents: true, actualCents: true } },
        },
      },
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <Link href="/events" className="text-muted hover:text-foreground text-sm">
        ← Shows & events
      </Link>
      <PageHeader
        eyebrow="PGI"
        title="Show series"
        description="Group a recurring show across years so its history lines up at a glance — the “should we do it again?” view."
      />

      <form action={createSeries} className="card p-4 flex items-end gap-3 flex-wrap">
        <label className="text-sm flex-1 min-w-[14rem]">
          <span className="text-muted">New series name *</span>
          <input name="name" required className="input mt-1" placeholder="e.g. Novi Home Show" />
        </label>
        <label className="text-sm flex-1 min-w-[10rem]">
          <span className="text-muted">Notes</span>
          <input name="notes" className="input mt-1" />
        </label>
        <button className="btn btn-primary text-sm">Add series</button>
      </form>

      <div className="space-y-4">
        {series.map((s) => {
          // Newest first (by earliest date), for the year-over-year read.
          const rows = s.events
            .map((e) => ({ e, range: eventDateRange(e.dates), totals: costTotals(e.costs) }))
            .sort((a, b) => (b.range.first?.getTime() ?? 0) - (a.range.first?.getTime() ?? 0));
          return (
            <div key={s.id} className="card p-5 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{s.name}</span>
                <span className="text-xs text-muted">
                  {s.events.length} event{s.events.length === 1 ? "" : "s"}
                </span>
                {s.notes && <span className="text-xs text-muted">· {s.notes}</span>}
              </div>
              {rows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-muted text-left">
                      <tr className="border-b border-border">
                        <th className="py-1.5 pr-3 font-medium">Show</th>
                        <th className="py-1.5 pr-3 font-medium">Dates</th>
                        <th className="py-1.5 pr-3 font-medium">Status</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Goal</th>
                        <th className="py-1.5 pr-3 font-medium text-right">Budget</th>
                        <th className="py-1.5 font-medium text-right">Actual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.e.id} className="border-b border-border/50">
                          <td className="py-1.5 pr-3">
                            <Link href={`/events/${r.e.id}`} className="text-teal hover:underline">
                              {r.e.name}
                            </Link>
                          </td>
                          <td className="py-1.5 pr-3 text-muted whitespace-nowrap">
                            {r.range.first ? formatDateSpan(r.range.first, r.range.last!) : "—"}
                          </td>
                          <td className="py-1.5 pr-3">{EVENT_STATUS_LABEL[r.e.status]}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{usd(r.e.goalCents)}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{usd(r.totals.budget)}</td>
                          <td className="py-1.5 text-right tabular-nums">{usd(r.totals.actual)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted">No events in this series yet — set the series on a show’s details.</p>
              )}
            </div>
          );
        })}
        {series.length === 0 && (
          <div className="card p-8 text-center text-muted text-sm">No series yet.</div>
        )}
      </div>
    </div>
  );
}
