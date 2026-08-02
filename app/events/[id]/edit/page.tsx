import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import {
  EVENT_STATUS_LABEL,
  EVENT_STATUS_ORDER,
  COST_TYPE_LABEL,
  COST_TYPE_ORDER,
  formatDateSpan,
  costTotals,
  usd,
} from "@/lib/events";
import { employeeName } from "@/lib/employees";
import PageHeader from "@/components/ui/PageHeader";
import ToastOnParam from "@/components/ui/ToastOnParam";
import {
  updateEvent,
  deleteEvent,
  addEventDate,
  removeEventDate,
  addEventCost,
  updateEventCost,
  removeEventCost,
  addEventStaff,
  removeEventStaff,
  addEventShift,
  removeEventShift,
} from "../../actions";

export const dynamic = "force-dynamic";

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function dollars(cents: number | null | undefined): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

export default async function EventEditPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getViewer();
  if (!can(me, "events:edit")) notFound();
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
    },
  });
  if (!event) notFound();

  const [employees, promoters, series] = await Promise.all([
    prisma.employee.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true, preferredName: true },
    }),
    prisma.promoter.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.showSeries.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totals = costTotals(event.costs);
  const hid = <input type="hidden" name="eventId" value={event.id} />;
  // Show the preferred/display name, then append the D/I code, so two employees
  // with the exact same legal name (e.g. a Jr. + Sr.) are tellable apart in the pickers.
  const empLabel = (e: { name: string; preferredName: string | null; code: string | null }) => {
    const n = employeeName(e);
    return e.code ? `${n} · ${e.code}` : n;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <ToastOnParam map={{ created: "Show created", saved: "Details saved" }} />
      <Link href={`/events/${event.id}`} className="text-muted hover:text-foreground text-sm">
        ← View show
      </Link>

      <PageHeader
        eyebrow="PGI · Edit"
        title={event.name}
        actions={
          <Link href={`/events/${event.id}`} className="btn btn-ghost text-sm">
            ← View show
          </Link>
        }
      />

      {/* ---- details ---- */}
      <form action={updateEvent} className="card p-5 space-y-4">
        <h2 className="font-semibold">Details</h2>
        {hid}
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <label className="sm:col-span-2">
            <span className="text-muted">Name *</span>
            <input name="name" defaultValue={event.name} required className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Short name</span>
            <input
              name="shortName"
              defaultValue={event.shortName ?? ""}
              maxLength={24}
              placeholder="e.g. Novi"
              className="input mt-1"
            />
            <span className="text-xs text-muted mt-1 block">Compact label for the scoreboard rings</span>
          </label>
          <label>
            <span className="text-muted">Status</span>
            <select name="status" defaultValue={event.status} className="input mt-1">
              {EVENT_STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {EVENT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-muted">Show goal ($)</span>
            <input name="goal" defaultValue={dollars(event.goalCents)} className="input mt-1" inputMode="decimal" />
          </label>
          <label>
            <span className="text-muted">Show leader</span>
            <select name="leaderEmployeeId" defaultValue={event.leaderEmployeeId ?? ""} className="input mt-1">
              <option value="">—</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empLabel(e)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-muted">Leads captured</span>
            <input name="leadCount" type="number" min={0} defaultValue={event.leadCount ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Sales reps needed</span>
            <input name="repsNeeded" type="number" min={0} defaultValue={event.repsNeeded ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Promoter</span>
            <select name="promoterId" defaultValue={event.promoterId ?? ""} className="input mt-1">
              <option value="">—</option>
              {promoters.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="text-muted">Series (for year-over-year)</span>
            <select name="seriesId" defaultValue={event.seriesId ?? ""} className="input mt-1">
              <option value="">—</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="sm:col-span-2">
            <span className="text-muted">Venue name</span>
            <input name="venueName" defaultValue={event.venueName ?? ""} className="input mt-1" />
          </label>
          <label className="sm:col-span-2">
            <span className="text-muted">Street address</span>
            <input name="address" defaultValue={event.address ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">City</span>
            <input name="city" defaultValue={event.city ?? ""} className="input mt-1" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="text-muted">State</span>
              <input name="state" defaultValue={event.state ?? ""} className="input mt-1" />
            </label>
            <label>
              <span className="text-muted">Zip</span>
              <input name="zip" defaultValue={event.zip ?? ""} className="input mt-1" />
            </label>
          </div>
          <label>
            <span className="text-muted">Booth #</span>
            <input name="boothNumber" defaultValue={event.boothNumber ?? ""} className="input mt-1" />
          </label>
          <label>
            <span className="text-muted">Booth size</span>
            <input name="boothSize" defaultValue={event.boothSize ?? ""} className="input mt-1" placeholder="e.g. 20×20" />
          </label>
          <label className="sm:col-span-2">
            <span className="text-muted">Notes / recap</span>
            <textarea name="notes" defaultValue={event.notes ?? ""} className="input mt-1" rows={3} />
          </label>
        </div>
        <button className="btn btn-primary text-sm">Save details</button>
      </form>

      {/* ---- dates ---- */}
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">Dates</h2>
        <p className="text-xs text-muted">Add a row per span — split-week shows get several.</p>
        {event.dates.length > 0 && (
          <ul className="divide-y divide-border/60 text-sm">
            {event.dates.map((d) => (
              <li key={d.id} className="py-2 flex items-center gap-3">
                <span>{formatDateSpan(d.startDate, d.endDate)}</span>
                {d.label && <span className="badge text-muted">{d.label}</span>}
                <form action={removeEventDate} className="ml-auto">
                  {hid}
                  <input type="hidden" name="dateId" value={d.id} />
                  <button className="text-xs text-muted hover:text-danger hover:underline">remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addEventDate} className="flex items-end gap-2 flex-wrap">
          {hid}
          <label className="text-sm">
            <span className="text-muted">Start</span>
            <input name="startDate" type="date" required className="input mt-1" />
          </label>
          <label className="text-sm">
            <span className="text-muted">End</span>
            <input name="endDate" type="date" className="input mt-1" />
          </label>
          <label className="text-sm">
            <span className="text-muted">Label</span>
            <input name="label" className="input mt-1" placeholder="Week 1" />
          </label>
          <button className="btn btn-ghost text-sm">Add span</button>
        </form>
      </div>

      {/* ---- costs ---- */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold">Costs</h2>
          <span className="text-sm text-muted ml-auto">
            Budget <span className="text-foreground font-medium">{usd(totals.budget)}</span> · Actual{" "}
            <span className="text-foreground font-medium">{usd(totals.actual)}</span>
          </span>
        </div>
        {event.costs.length > 0 && (
          <div className="space-y-2">
            {event.costs.map((c) => (
              <div key={c.id} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-sm">{COST_TYPE_LABEL[c.type]}</span>
                  {c.paid && <span className="badge text-teal">paid</span>}
                  <form action={removeEventCost} className="ml-auto">
                    {hid}
                    <input type="hidden" name="costId" value={c.id} />
                    <button className="text-xs text-muted hover:text-danger hover:underline">remove</button>
                  </form>
                </div>
                <form action={updateEventCost} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                  {hid}
                  <input type="hidden" name="costId" value={c.id} />
                  <label className="text-xs">
                    <span className="text-muted">Detail</span>
                    <input name="label" defaultValue={c.label ?? ""} className="input mt-1" />
                  </label>
                  <label className="text-xs">
                    <span className="text-muted">Budget</span>
                    <input name="budget" type="number" min={0} step="0.01"
                      defaultValue={c.budgetCents != null ? (c.budgetCents / 100).toFixed(2) : ""}
                      className="input mt-1" />
                  </label>
                  <label className="text-xs">
                    <span className="text-muted">Actual</span>
                    <input name="actual" type="number" min={0} step="0.01"
                      defaultValue={c.actualCents != null ? (c.actualCents / 100).toFixed(2) : ""}
                      className="input mt-1" />
                  </label>
                  <label className="text-xs">
                    <span className="text-muted">Due</span>
                    <input name="dueDate" type="date"
                      defaultValue={c.dueDate ? c.dueDate.toISOString().slice(0, 10) : ""}
                      className="input mt-1" />
                  </label>
                  <div className="flex items-center gap-3 pb-1.5">
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" name="paid" defaultChecked={c.paid} /> Paid
                    </label>
                    <button className="btn btn-ghost text-xs">Save</button>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}
        <form action={addEventCost} className="grid sm:grid-cols-6 gap-2 items-end">
          {hid}
          <label className="text-sm sm:col-span-1">
            <span className="text-muted">Type</span>
            <select name="type" className="input mt-1">
              {COST_TYPE_ORDER.map((t) => (
                <option key={t} value={t}>
                  {COST_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-muted">Detail</span>
            <input name="label" className="input mt-1" />
          </label>
          <label className="text-sm">
            <span className="text-muted">Budget $</span>
            <input name="budget" className="input mt-1" inputMode="decimal" />
          </label>
          <label className="text-sm">
            <span className="text-muted">Actual $</span>
            <input name="actual" className="input mt-1" inputMode="decimal" />
          </label>
          <button className="btn btn-ghost text-sm">Add cost</button>
        </form>
      </div>

      {/* ---- staff ---- */}
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">Staff</h2>
        {event.staff.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {event.staff.map((s) => (
              <li key={s.id} className="badge flex items-center gap-2">
                {s.employee.name}
                {s.employee.id === event.leaderEmployeeId && <span className="text-teal text-xs">leader</span>}
                {s.role && <span className="text-muted text-xs">{s.role}</span>}
                <form action={removeEventStaff}>
                  {hid}
                  <input type="hidden" name="staffId" value={s.id} />
                  <button className="text-muted hover:text-danger">×</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addEventStaff} className="flex items-end gap-2 flex-wrap">
          {hid}
          <label className="text-sm min-w-[14rem]">
            <span className="text-muted">Add staff</span>
            <select name="employeeId" required className="input mt-1">
              <option value="">Choose an employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empLabel(e)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted">Role</span>
            <input name="role" className="input mt-1" placeholder="optional" />
          </label>
          <button className="btn btn-ghost text-sm">Add</button>
        </form>
      </div>

      {/* ---- shifts ---- */}
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold">Shift schedule</h2>
        {event.shifts.length > 0 && (
          <ul className="divide-y divide-border/60 text-sm">
            {event.shifts.map((s) => (
              <li key={s.id} className="py-2 flex items-center gap-3 flex-wrap">
                <span className="whitespace-nowrap">{fmt(s.date)}</span>
                <span className="font-medium">{s.employee.name}</span>
                {(s.startTime || s.endTime) && (
                  <span className="text-muted">
                    {s.startTime ?? "?"}–{s.endTime ?? "?"}
                  </span>
                )}
                {s.note && <span className="text-muted text-xs">{s.note}</span>}
                <form action={removeEventShift} className="ml-auto">
                  {hid}
                  <input type="hidden" name="shiftId" value={s.id} />
                  <button className="text-xs text-muted hover:text-danger hover:underline">remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addEventShift} className="flex items-end gap-2 flex-wrap">
          {hid}
          <label className="text-sm min-w-[12rem]">
            <span className="text-muted">Employee</span>
            <select name="employeeId" required className="input mt-1">
              <option value="">Choose…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empLabel(e)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted">Date</span>
            <input name="date" type="date" required className="input mt-1" />
          </label>
          <label className="text-sm">
            <span className="text-muted">Start</span>
            <input name="startTime" type="time" className="input mt-1" />
          </label>
          <label className="text-sm">
            <span className="text-muted">End</span>
            <input name="endTime" type="time" className="input mt-1" />
          </label>
          <button className="btn btn-ghost text-sm">Add shift</button>
        </form>
      </div>

      {/* ---- danger ---- */}
      <form action={deleteEvent} className="flex justify-end">
        {hid}
        <button className="btn btn-ghost text-sm text-danger">Delete show</button>
      </form>
    </div>
  );
}
