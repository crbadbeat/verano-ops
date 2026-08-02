import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { ensureStagingLanes } from "@/lib/locations";
import { summarizeTrip } from "@/lib/staging";
import { stagingDateForLoadDate, isoDate } from "@/lib/scheduling";
import TripStageNav from "@/components/staging/TripStageNav";
import StatusChip from "@/components/ui/StatusChip";
import { assignLanes, markStaged, reopenStaging } from "../../actions";

export const dynamic = "force-dynamic";

function longDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

export default async function StageConfirmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getViewer();
  const canManage = can(user, "staging:assign");
  const canPick = can(user, "staging:pick");
  const canQc = can(user, "qc:signoff");

  const trip = await prisma.deliveryTrip.findUnique({
    where: { id },
    include: {
      lanes: { orderBy: { position: "asc" }, include: { lane: { select: { code: true, name: true } } } },
      stagedBy: { select: { name: true, email: true } },
    },
  });
  if (!trip) notFound();

  const summary = await summarizeTrip(trip.id);
  const shortCount = summary?.shortCount ?? 0;
  const stagedTotal = summary?.stagedTotal ?? 0;
  const neededTotal = summary?.neededTotal ?? 0;

  const staging = trip.status === "STAGING";
  const staged = trip.status === "STAGED";
  const stageBy = stagingDateForLoadDate(trip.loadDate);
  const laneIds = trip.lanes.map((l) => l.laneId);
  const lanes = canManage && (trip.status === "FINALIZED" || staging) ? await ensureStagingLanes() : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/staging" className="text-muted hover:text-foreground text-sm">
          ← Pick queue
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
        </p>
      </div>

      <TripStageNav tripId={trip.id} active="confirm" />

      {staging && trip.qcNote && (
        <div className="card p-4 border-danger/40 text-sm">
          <span className="text-danger font-semibold">Sent back by QC:</span> {trip.qcNote}
        </div>
      )}

      {/* Lanes: assign / update (manager, before staged) */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold">Lanes</h2>
          {trip.lanes.length > 0 ? (
            trip.lanes.map((l, i) => (
              <span key={l.id} className={`badge font-mono ${i === 0 ? "text-teal" : "text-muted"}`}>
                {l.lane.code.replace("LANE-", "")}
                {i === 0 ? " (primary)" : ""}
              </span>
            ))
          ) : (
            <span className="badge text-danger">none assigned</span>
          )}
        </div>
        <p className="text-xs text-muted">
          Everything stages to the primary lane; extra lanes are physical direction only.
        </p>
        {canManage && (trip.status === "FINALIZED" || staging) && (
          <form action={assignLanes} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tripId" value={trip.id} />
            {[0, 1, 2].map((i) => (
              <label key={i} className="text-xs text-muted space-y-1 block">
                <span>{i === 0 ? "Primary lane" : `Lane ${i + 1}`}</span>
                <select name="laneId" defaultValue={laneIds[i] ?? ""} className="input py-1">
                  <option value="">{i === 0 ? "Select…" : "—"}</option>
                  {lanes.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button className="btn btn-primary py-1.5" type="submit">
              {trip.status === "FINALIZED" ? "Assign & start picking" : "Update lanes"}
            </button>
          </form>
        )}
        {trip.status === "FINALIZED" && !canManage && (
          <p className="text-sm text-muted">Waiting for a manager to assign lanes.</p>
        )}
      </div>

      {/* Staged-vs-needed rollup */}
      {summary && summary.lines.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border flex items-center gap-3">
            <h2 className="font-semibold">Staged so far</h2>
            <span className="badge text-muted">
              {stagedTotal}/{neededTotal}
            </span>
            {shortCount > 0 && <span className="badge text-danger">{shortCount} short</span>}
          </div>
          <ul className="divide-y divide-border/60">
            {summary.lines.map((l) => (
              <li key={l.productId} className="px-4 py-2.5 flex items-center gap-2 flex-wrap text-sm">
                <span className="font-mono text-xs">{l.sku}</span>
                <span className="text-muted truncate">{l.name}</span>
                <span className="ml-auto text-xs tabular-nums">
                  <span className={l.remaining === 0 ? "text-success" : "text-muted"}>
                    {l.staged}/{l.needed}
                  </span>
                  {l.remaining > 0 && <span className="text-danger"> · {l.remaining} to go</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Confirm staging (picker/manager) */}
      {staging && canPick && (
        <div className="card p-5 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/staging/${trip.id}`} className="btn btn-ghost text-sm">
              ← Back to picking
            </Link>
            <form action={markStaged} className="ml-auto">
              <input type="hidden" name="tripId" value={trip.id} />
              <button className="btn btn-primary" type="submit" disabled={trip.lanes.length === 0}>
                {shortCount > 0 ? "Mark staged (with shortfall)" : "Mark staged"}
              </button>
            </form>
          </div>
          {shortCount > 0 && (
            <p className="text-sm text-muted">
              {shortCount} item(s) not fully staged — the shortfall stays on record and QC will see it.
            </p>
          )}
          {trip.lanes.length === 0 && (
            <p className="text-sm text-danger">Assign a primary lane before staging.</p>
          )}
        </div>
      )}

      {/* Staged — ready for QC */}
      {staged && (
        <div className="card p-5 flex items-center gap-3 flex-wrap">
          <p className="text-sm text-muted">
            Staged
            {trip.stagedAt
              ? ` ${trip.stagedAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`
              : ""}
            {trip.stagedBy?.name ? ` by ${trip.stagedBy.name}` : ""}
            {shortCount > 0 ? ` · ${shortCount} short` : " · complete"}.
          </p>
          {canQc && (
            <Link href={`/qc/${trip.id}`} className="btn btn-primary text-sm ml-auto">
              Send to QC →
            </Link>
          )}
          {canManage && (
            <form action={reopenStaging}>
              <input type="hidden" name="tripId" value={trip.id} />
              <button className="btn btn-ghost text-sm" type="submit">
                Re-open for picking
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
