import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import {
  EVENT_STATUS_LABEL,
  COST_TYPE_LABEL,
  eventDateRange,
  formatDateSpan,
  costTotals,
  usd,
} from "@/lib/events";
import PageHeader from "@/components/ui/PageHeader";
import StatusChip from "@/components/ui/StatusChip";
import ToastOnParam from "@/components/ui/ToastOnParam";
import { currentWeather, dailyForecast, weatherInfo, type DailyWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A single label / value pair in the overview grid. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums">{value}</dd>
    </div>
  );
}

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getViewer();
  if (!can(me, "events:view")) notFound();
  const canEdit = can(me, "events:edit");
  const { id } = await params;

  const event = await prisma.showEvent.findUnique({
    where: { id },
    include: {
      dates: { orderBy: { startDate: "asc" } },
      costs: { orderBy: { createdAt: "asc" } },
      staff: { include: { employee: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      shifts: {
        include: { employee: { select: { name: true } } },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      },
      leader: { select: { id: true, name: true } },
      promoter: { select: { name: true } },
      series: { select: { name: true } },
      weatherDays: { orderBy: { date: "asc" } },
    },
  });
  if (!event) notFound();

  const range = eventDateRange(event.dates);
  const totals = costTotals(event.costs);
  const nowWx =
    event.latitude != null && event.longitude != null
      ? await currentWeather(event.latitude, event.longitude)
      : null;

  // Per-show-day weather: captured actuals where we have them, forecast for the
  // rest of the run (Open-Meteo serves ~16 days ahead; days beyond show "—").
  const DAY_MS = 86_400_000;
  const showDays: { date: string; actual: (typeof event.weatherDays)[number] | null; forecast: DailyWeather | null }[] = [];
  if (event.latitude != null && event.longitude != null && range.first && range.last) {
    const startMs = Date.UTC(range.first.getUTCFullYear(), range.first.getUTCMonth(), range.first.getUTCDate());
    const endMs = Date.UTC(range.last.getUTCFullYear(), range.last.getUTCMonth(), range.last.getUTCDate());
    const nDays = Math.min(31, Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1));
    const fc = await dailyForecast(
      event.latitude,
      event.longitude,
      iso(new Date(startMs)),
      iso(new Date(startMs + (nDays - 1) * DAY_MS))
    );
    const actualByDay = new Map(event.weatherDays.map((w) => [iso(w.date), w]));
    for (let i = 0; i < nDays; i++) {
      const dISO = iso(new Date(startMs + i * DAY_MS));
      showDays.push({ date: dISO, actual: actualByDay.get(dISO) ?? null, forecast: fc.get(dISO) ?? null });
    }
  }

  const dateSpan = range.first ? formatDateSpan(range.first, range.last!) : "No dates set";
  const location =
    [event.city, event.state].filter(Boolean).join(", ") ||
    event.venueName ||
    null;
  const description = location ? `${dateSpan} · ${location}` : dateSpan;

  // Overview fields — only those that are set are rendered.
  const overview: { label: string; value: React.ReactNode }[] = [];
  if (event.venueName) overview.push({ label: "Venue", value: event.venueName });
  if (event.address) overview.push({ label: "Address", value: event.address });
  if (event.city || event.state || event.zip)
    overview.push({
      label: "City / State / Zip",
      value: [[event.city, event.state].filter(Boolean).join(", "), event.zip].filter(Boolean).join(" "),
    });
  if (event.boothNumber) overview.push({ label: "Booth #", value: event.boothNumber });
  if (event.boothSize) overview.push({ label: "Booth size", value: event.boothSize });
  if (event.leader?.name) overview.push({ label: "Show leader", value: event.leader.name });
  if (event.promoter?.name) overview.push({ label: "Promoter", value: event.promoter.name });
  if (event.series?.name) overview.push({ label: "Series", value: event.series.name });
  if (event.leadCount != null) overview.push({ label: "Leads captured", value: event.leadCount });
  if (event.repsNeeded != null) overview.push({ label: "Reps needed", value: event.repsNeeded });
  if (event.goalCents != null) overview.push({ label: "Show goal", value: usd(event.goalCents) });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <ToastOnParam map={{ saved: "Show updated", created: "Show created" }} />
      <Link href="/events" className="text-muted hover:text-foreground text-sm">
        ← Shows & events
      </Link>

      <PageHeader
        eyebrow={`PGI · ${EVENT_STATUS_LABEL[event.status]}`}
        title={
          <span className="flex items-center gap-3 flex-wrap">
            {event.name}
            <StatusChip status={event.status} label={EVENT_STATUS_LABEL[event.status]} />
          </span>
        }
        description={description}
        actions={
          <>
            <Link href="/events" className="btn btn-ghost text-sm">Back to shows</Link>
            {canEdit && (
              <Link href={`/events/${event.id}/edit`} className="btn btn-primary text-sm">Edit show</Link>
            )}
          </>
        }
      />

      {/* ---- overview ---- */}
      {overview.length > 0 && (
        <div className="card p-5">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
            {overview.map((f) => (
              <Field key={f.label} label={f.label} value={f.value} />
            ))}
          </dl>
        </div>
      )}

      {/* ---- weather ---- */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold">Weather</h2>
          {nowWx && (
            <span className="text-sm text-muted">
              Now: {nowWx.emoji} {nowWx.tempF}°F · {nowWx.label} · {nowWx.windMph} mph wind
            </span>
          )}
        </div>
        {event.latitude == null ? (
          <p className="p-4 text-sm text-muted">Add a city and state on the show, then save, to enable weather tracking.</p>
        ) : showDays.length === 0 ? (
          <p className="p-4 text-sm text-muted">Add show dates to see the daily weather.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="px-4 py-2 font-medium">Show day</th>
                  <th className="px-4 py-2 font-medium">Conditions</th>
                  <th className="px-4 py-2 font-medium text-right">High</th>
                  <th className="px-4 py-2 font-medium text-right">Low</th>
                  <th className="px-4 py-2 font-medium text-right">Precip</th>
                  <th className="px-4 py-2 font-medium text-right">Wind</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {showDays.map((d) => {
                  const w = d.actual ?? d.forecast;
                  const info = weatherInfo(w?.weatherCode ?? null);
                  return (
                    <tr key={d.date}>
                      <td className="px-4 py-2 tabular-nums">{d.date}</td>
                      <td className="px-4 py-2">{w ? `${info.emoji} ${info.label}` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{w?.tempMaxF != null ? `${Math.round(w.tempMaxF)}°` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{w?.tempMinF != null ? `${Math.round(w.tempMinF)}°` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{w?.precipitationIn != null ? `${w.precipitationIn}"` : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{w?.windMph != null ? `${Math.round(w.windMph)} mph` : "—"}</td>
                      <td className="px-4 py-2">
                        {d.actual ? (
                          <span className="badge text-teal">actual</span>
                        ) : d.forecast ? (
                          <span className="badge text-muted">forecast</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- dates ---- */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Dates</h2>
        </div>
        {event.dates.length === 0 ? (
          <p className="p-4 text-sm text-muted">No dates set</p>
        ) : (
          <ul className="divide-y divide-border">
            {event.dates.map((d) => (
              <li key={d.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className="tabular-nums">{formatDateSpan(d.startDate, d.endDate)}</span>
                {d.label && <span className="badge text-muted">{d.label}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- costs ---- */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Costs</h2>
        </div>
        {event.costs.length === 0 ? (
          <p className="p-4 text-sm text-muted">No costs tracked</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Detail</th>
                  <th className="px-4 py-2 font-medium text-right">Budget</th>
                  <th className="px-4 py-2 font-medium text-right">Actual</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                  <th className="px-4 py-2 font-medium">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {event.costs.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2">{COST_TYPE_LABEL[c.type]}</td>
                    <td className="px-4 py-2 text-muted">{c.label ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{usd(c.budgetCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{usd(c.actualCents)}</td>
                    <td className="px-4 py-2 tabular-nums">{c.dueDate ? iso(c.dueDate) : "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`badge ${c.paid ? "text-teal" : "text-muted"}`}>
                        {c.paid ? "Paid" : "Unpaid"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium bg-surface-2">
                  <td className="px-4 py-2" colSpan={2}>Totals</td>
                  <td className="px-4 py-2 text-right tabular-nums">{usd(totals.budget)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{usd(totals.actual)}</td>
                  <td className="px-4 py-2" colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* ---- staff ---- */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Staff</h2>
        </div>
        <div className="p-4">
          {event.staff.length === 0 ? (
            <p className="text-sm text-muted">No staff assigned</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {event.staff.map((s) => (
                <li key={s.id}>
                  <span className="badge">
                    {s.employee.name}
                    {s.employee.id === event.leaderEmployeeId
                      ? " · Show Leader"
                      : s.role
                      ? ` · ${s.role}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ---- shifts ---- */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="font-semibold">Shift schedule</h2>
        </div>
        {event.shifts.length === 0 ? (
          <p className="p-4 text-sm text-muted">No shifts scheduled</p>
        ) : (
          <ul className="divide-y divide-border">
            {event.shifts.map((s) => (
              <li key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap text-sm">
                <span className="whitespace-nowrap tabular-nums">{fmt(s.date)}</span>
                <span className="font-medium">{s.employee.name}</span>
                <span className="text-muted tabular-nums">
                  {s.startTime || s.endTime ? `${s.startTime ?? "?"}–${s.endTime ?? "?"}` : "—"}
                </span>
                {s.note && <span className="text-muted text-xs">{s.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- notes ---- */}
      {event.notes && (
        <div className="card p-5">
          <h2 className="font-semibold mb-2">Notes</h2>
          <p className="whitespace-pre-wrap text-sm">{event.notes}</p>
        </div>
      )}
    </div>
  );
}
