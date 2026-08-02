import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound, redirect } from "next/navigation";

import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { summarizeTrip } from "@/lib/staging";
import { stagingDateForLoadDate, isoDate } from "@/lib/scheduling";
import TripStageNav from "@/components/staging/TripStageNav";
import StatusChip from "@/components/ui/StatusChip";
import { passQc, rejectQc } from "../actions";

export const dynamic = "force-dynamic";

function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function dateTime(d: Date): string {
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function QcWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getViewer();
  if (!can(user, "qc:signoff")) redirect("/");

  const trip = await prisma.deliveryTrip.findUnique({
    where: { id },
    include: {
      lanes: { orderBy: { position: "asc" }, include: { lane: { select: { code: true } } } },
      qcBy: { select: { name: true, email: true } },
      stagedBy: { select: { name: true, email: true } },
    },
  });
  if (!trip) notFound();

  const summary = await summarizeTrip(trip.id);
  const shortCount = summary?.shortCount ?? 0;
  const stagedTotal = summary?.stagedTotal ?? 0;
  const neededTotal = summary?.neededTotal ?? 0;
  const shortLines = (summary?.lines ?? []).filter((l) => l.remaining > 0);

  const stageBy = stagingDateForLoadDate(trip.loadDate);
  const awaitingQc = trip.status === "STAGED";
  const passed = ["QC_PASSED", "LOADED", "DELIVERED"].includes(trip.status);
  const qcName = trip.qcBy?.name ?? trip.qcBy?.email ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/qc" className="text-muted hover:text-foreground text-sm">
          ← QC queue
        </Link>
        <StatusChip status={trip.status} />
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {trip.name ?? `Trip · ${isoDate(trip.loadDate)}`}
        </h1>
        <p className="text-muted text-sm mt-1">
          Loads {longDate(trip.loadDate)} · stage by {longDate(stageBy)} ·{" "}
          {stagedTotal}/{neededTotal} units staged
          {shortCount > 0 && <span className="text-danger"> · {shortCount} short</span>}
          {trip.lanes.length > 0 && (
            <>
              {" "}
              · lane{" "}
              <span className="font-mono text-teal">
                {trip.lanes[0].lane.code.replace("LANE-", "")}
              </span>
            </>
          )}
        </p>
      </div>

      <TripStageNav tripId={trip.id} active="qc" />

      {/* Stops on this trip */}
      {summary && summary.stops.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <h2 className="font-semibold">Stops</h2>
            <span className="badge text-muted">{summary.stops.length}</span>
          </div>
          <ul className="divide-y divide-border/60">
            {summary.stops.map((s) => (
              <li key={s.orderId} className="px-4 py-2.5 flex items-center gap-2 text-sm">
                <Link href={`/orders/${s.orderId}`} className="font-mono text-xs hover:underline">
                  {s.orderNo}
                </Link>
                <span className="truncate">{s.customer}</span>
                <span className="ml-auto text-xs text-muted tabular-nums">
                  {s.itemCount} {s.itemCount === 1 ? "item" : "items"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Shortfall — QC needs to see exactly what isn't fully staged */}
      {shortLines.length > 0 && (
        <div className="card overflow-hidden border-danger/40">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <h2 className="font-semibold text-danger">Short — staged below need</h2>
            <span className="badge text-danger">{shortLines.length}</span>
          </div>
          <ul className="divide-y divide-border/60">
            {shortLines.map((l) => (
              <li key={l.productId} className="px-4 py-2.5 flex items-center gap-2 flex-wrap text-sm">
                <span className="font-mono text-xs">{l.sku}</span>
                <span className="text-muted truncate">{l.name}</span>
                <span className="ml-auto text-xs tabular-nums">
                  {l.staged}/{l.needed}
                  <span className="text-danger"> · {l.remaining} short</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Prior QC feedback, if this trip bounced before */}
      {trip.qcNote && !passed && (
        <div className="card p-4 text-sm">
          <span className="text-muted">Last QC note: </span>
          {trip.qcNote}
        </div>
      )}

      {/* The decision */}
      {awaitingQc ? (
        <div className="space-y-4">
          <form action={passQc} className="card p-5 space-y-3">
            <input type="hidden" name="tripId" value={trip.id} />
            <h2 className="font-semibold">Pass QC</h2>
            <p className="text-sm text-muted">
              Confirms the trip is correctly picked and staged, and hands it to dispatch.
              {shortCount > 0 && (
                <span className="text-danger"> Passing accepts the {shortCount}-item shortfall.</span>
              )}
            </p>
            <label className="text-sm text-muted space-y-1 block">
              <span>Note (optional)</span>
              <textarea name="qcNote" rows={2} className="input w-full" placeholder="Anything worth recording…" />
            </label>
            <button className="btn btn-primary" type="submit">
              Pass QC →
            </button>
          </form>

          <form action={rejectQc} className="card p-5 space-y-3">
            <input type="hidden" name="tripId" value={trip.id} />
            <h2 className="font-semibold text-danger">Reject — back to picking</h2>
            <p className="text-sm text-muted">
              Returns the trip to the warehouse for correction. A reason is required.
            </p>
            <label className="text-sm text-muted space-y-1 block">
              <span>What needs fixing</span>
              <textarea name="qcNote" rows={2} required className="input w-full" placeholder="e.g. wrong glass color on order P14454" />
            </label>
            <button className="btn btn-ghost text-danger" type="submit">
              Reject trip
            </button>
          </form>
        </div>
      ) : passed ? (
        <div className="card p-5 flex items-center gap-3 flex-wrap">
          <p className="text-sm text-muted">
            Passed QC
            {trip.qcAt ? ` ${dateTime(trip.qcAt)}` : ""}
            {qcName ? ` by ${qcName}` : ""}
            {trip.qcNote ? ` · “${trip.qcNote}”` : ""}.
          </p>
          <Link href={`/dispatch/${trip.id}`} className="btn btn-primary text-sm ml-auto">
            Go to dispatch →
          </Link>
        </div>
      ) : (
        <div className="card p-5 text-sm text-muted">
          This trip isn&apos;t staged yet, so there&apos;s nothing to inspect.{" "}
          <Link href={`/staging/${trip.id}`} className="text-ember underline">
            Back to picking
          </Link>
          .
        </div>
      )}
    </div>
  );
}
