import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import Link from "next/link";
import { can } from "@/lib/rbac";
import { parseRange, presetRange } from "@/lib/reporting/range";
import { getReconciliation } from "@/lib/reporting/reconciliation";
import { moneyFloor } from "@/lib/reporting/format";
import PageHeader from "@/components/ui/PageHeader";
import EventsTabs from "@/components/events/EventsTabs";
import EventsRangeControl from "@/components/events/EventsRangeControl";
import RepAvatar from "@/components/employees/RepAvatar";
import EmptyState from "@/components/ui/EmptyState";

export const dynamic = "force-dynamic";

function nowDate(): Date {
  return new Date();
}

/** Signed whole-dollar delta, coloured (order bigger = teal, smaller = ember). */
function Variance({ cents }: { cents: number | null }) {
  if (cents == null) return <span className="text-muted">—</span>;
  if (cents === 0) return <span className="text-muted tabular-nums">$0</span>;
  const up = cents > 0;
  return (
    <span className={`tabular-nums ${up ? "text-teal" : "text-ember"}`}>
      {up ? "+" : "−"}
      {moneyFloor(Math.abs(cents))}
    </span>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "teal" | "ember" }) {
  const c = tone === "teal" ? "text-teal" : tone === "ember" ? "text-ember" : "text-foreground";
  return (
    <div className="card px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${c}`}>{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

export default async function ReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const me = await getViewer();
  if (!can(me, "events:view")) notFound();

  const sp = await searchParams;
  const now = nowDate();
  const range = sp.from || sp.to || sp.preset ? parseRange(sp, now) : presetRange("mtd", now);
  const { rows, summary } = await getReconciliation(range);

  const matchPct = summary.total > 0 ? Math.floor((summary.matched / summary.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <PageHeader
        eyebrow="PGI"
        title="Reconciliation"
        description="Self-reported sales matched against the real NetSuite order — so what reps logged and what the order book shows stay honest."
        actions={<EventsRangeControl current={range.preset} from={range.fromIso} to={range.toIso} />}
      />
      <EventsTabs />
      <p className="text-xs text-muted">
        {range.label} · {range.fromIso} → {range.toIso}
      </p>

      {summary.total === 0 ? (
        <EmptyState message="No self-reported sales in this range." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi label="Entries" value={summary.total.toLocaleString()} />
            <Kpi label="Matched to an order" value={summary.matched.toLocaleString()} tone="teal" sub={`${matchPct}% of entries`} />
            <Kpi label="Unmatched" value={summary.unmatched.toLocaleString()} tone="ember" />
            <Kpi label="Reported total" value={moneyFloor(summary.reportedCents)} />
            <Kpi
              label="Matched variance"
              value={summary.matched > 0 ? moneyFloor(summary.varianceCents) : "—"}
              sub={summary.matched > 0 ? "order − reported" : "nothing matched yet"}
            />
          </div>

          {summary.matched === 0 && (
            <div className="card p-4 text-sm text-muted">
              Nothing here is matched to a NetSuite order yet — the automatic matching job isn&apos;t
              live, so these are all pending reconciliation. Once matching runs, each row will show its
              order number and the gap between reported and booked amounts.
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted border-b border-border">
                <tr>
                  <th className="py-2 px-3 font-medium">Sold</th>
                  <th className="py-2 px-3 font-medium">Rep</th>
                  <th className="py-2 px-3 font-medium">Customer</th>
                  <th className="py-2 px-3 font-medium">Show</th>
                  <th className="py-2 px-3 font-medium text-right">Reported</th>
                  <th className="py-2 px-3 font-medium">Order</th>
                  <th className="py-2 px-3 font-medium text-right">Order total</th>
                  <th className="py-2 px-3 font-medium text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 px-3 whitespace-nowrap tabular-nums text-muted">{r.soldAt ?? "—"}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <RepAvatar id={r.repId} name={r.repName} size={24} />
                        {r.repName}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">{r.customer || "—"}</td>
                    <td className="py-2 px-3 max-w-[16rem] truncate" title={r.showName ?? ""}>{r.showName ?? "—"}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{moneyFloor(r.reportedCents)}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.matched && r.orderNo ? (
                        <Link href={`/orders?q=${encodeURIComponent(r.orderNo)}`} className="text-teal hover:underline">
                          {r.orderNo}
                        </Link>
                      ) : (
                        <span className="badge text-muted">Unmatched</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {r.orderTotalCents != null ? moneyFloor(r.orderTotalCents) : <span className="text-muted">—</span>}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <Variance cents={r.varianceCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
