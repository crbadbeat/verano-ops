import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound, redirect } from "next/navigation";

import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { summarizeTrip } from "@/lib/staging";
import { isoDate } from "@/lib/scheduling";
import TripStageNav from "@/components/staging/TripStageNav";
import StatusChip from "@/components/ui/StatusChip";
import SignaturePad from "@/components/SignaturePad";
import { markDelivered, signOffDeparture } from "../actions";

export const dynamic = "force-dynamic";

function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function dateTime(d: Date): string {
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function DispatchWorkspace({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getViewer();
  if (!can(user, "dispatch:signoff")) redirect("/");

  const trip = await prisma.deliveryTrip.findUnique({
    where: { id },
    include: {
      lanes: { orderBy: { position: "asc" }, include: { lane: { select: { code: true } } } },
      qcBy: { select: { name: true, email: true } },
      deliveredBy: { select: { name: true, email: true } },
    },
  });
  if (!trip) notFound();

  const summary = await summarizeTrip(trip.id);
  const manifest = (summary?.lines ?? []).filter((l) => l.staged > 0);
  const shipUnits = manifest.reduce((s, l) => s + l.staged, 0);

  const primaryLaneCode = trip.lanes[0]?.lane.code.replace("LANE-", "") ?? null;
  const readyToDepart = trip.status === "QC_PASSED";
  const loaded = trip.status === "LOADED";
  const delivered = trip.status === "DELIVERED";
  const deliveredName = trip.deliveredBy?.name ?? trip.deliveredBy?.email ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/dispatch" className="text-muted hover:text-foreground text-sm">
          ← Dispatch
        </Link>
        <StatusChip status={trip.status} />
      </div>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {trip.name ?? `Trip · ${isoDate(trip.loadDate)}`}
        </h1>
        <p className="text-muted text-sm mt-1">
          Loads {longDate(trip.loadDate)} ·{" "}
          {summary?.stops.length ?? 0} {(summary?.stops.length ?? 0) === 1 ? "stop" : "stops"} ·{" "}
          {shipUnits} {shipUnits === 1 ? "unit" : "units"} staged
          {primaryLaneCode && (
            <>
              {" "}
              · lane <span className="font-mono text-teal">{primaryLaneCode}</span>
            </>
          )}
        </p>
      </div>

      <TripStageNav tripId={trip.id} active="dispatch" />

      {/* Load manifest — what the driver is signing for */}
      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">On the truck</h2>
          <span className="badge text-muted">{manifest.length}</span>
        </div>
        {manifest.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            Nothing is staged in the lane for this trip.
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {manifest.map((l) => (
              <li key={l.productId} className="px-4 py-2.5 flex items-center gap-2 flex-wrap text-sm">
                <span className="font-mono text-xs">{l.sku}</span>
                <span className="text-muted truncate">{l.name}</span>
                <span className="ml-auto text-xs tabular-nums">
                  {l.staged}
                  {l.remaining > 0 && <span className="text-danger"> · {l.remaining} short</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The action, by stage */}
      {readyToDepart ? (
        <form action={signOffDeparture} className="card p-5 space-y-4">
          <input type="hidden" name="tripId" value={trip.id} />
          <div>
            <h2 className="font-semibold">Driver sign-off</h2>
            <p className="text-sm text-muted mt-1">
              Inspect the load, then sign to depart. This relieves the {shipUnits}{" "}
              {shipUnits === 1 ? "unit" : "units"} out of the lane — stock leaves the warehouse now.
            </p>
          </div>
          <label className="text-sm text-muted space-y-1 block">
            <span>Driver name</span>
            <input name="driverName" required className="input w-full" placeholder="Who is driving" />
          </label>
          <SignaturePad name="signatureData" label="Driver signature" />
          <button className="btn btn-primary" type="submit" disabled={manifest.length === 0}>
            Sign off &amp; depart →
          </button>
          {manifest.length === 0 && (
            <p className="text-sm text-danger">Nothing is staged to ship.</p>
          )}
        </form>
      ) : loaded ? (
        <div className="card p-5 space-y-3">
          <p className="text-sm text-muted">
            Departed
            {trip.departedAt ? ` ${dateTime(trip.departedAt)}` : ""}
            {trip.driverName ? ` · driver ${trip.driverName}` : ""}
            {trip.signatureData ? " · signed" : ""}.
          </p>
          <form action={markDelivered}>
            <input type="hidden" name="tripId" value={trip.id} />
            <button className="btn btn-primary" type="submit">
              Mark delivered
            </button>
          </form>
        </div>
      ) : delivered ? (
        <div className="card p-5 text-sm text-muted">
          Delivered
          {trip.deliveredAt ? ` ${dateTime(trip.deliveredAt)}` : ""}
          {deliveredName ? ` · closed by ${deliveredName}` : ""}
          {trip.driverName ? ` · driver ${trip.driverName}` : ""}.
        </div>
      ) : (
        <div className="card p-5 text-sm text-muted">
          This trip hasn&apos;t passed QC yet, so it can&apos;t be dispatched.{" "}
          <Link href={`/qc/${trip.id}`} className="text-ember underline">
            Go to QC
          </Link>
          .
        </div>
      )}
    </div>
  );
}
