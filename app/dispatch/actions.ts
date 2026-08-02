"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { requireCan } from "@/lib/rbac";
import { mainWarehouseUnitCosts } from "@/lib/netsuite-orders-import";

// Driver sign-off — the moment stock finally leaves the warehouse. The goods
// were moved bin → lane by picking (a conserved PICK pair); departure relieves
// them out of the lane as the FIRST native SHIPMENT out of the hub, tagged with
// the trip. Shape ported from departTransfer (transfers/actions.ts): validate,
// require driver name + drawn signature, then write the ledger and stamp the
// sign-off columns in one transaction.
//
// NB: TRANSFER-type trips deplete Ocoee here too but do not yet land at their
// destination — routing them through the in-transit / receiveTransfer flow is a
// later step; for now sign-off is the single depletion point for every trip.

function touch(tripId?: string) {
  revalidatePath("/dispatch");
  revalidatePath("/floor");
  revalidatePath("/inventory");
  if (tripId) revalidatePath(`/dispatch/${tripId}`);
}

/**
 * Sign off + depart a QC-passed trip: write negative SHIPMENT rows for whatever
 * is staged in the primary lane, then mark the trip LOADED with the driver's
 * name, signature and departure time.
 */
export async function signOffDeparture(formData: FormData): Promise<void> {
  const user = await getViewer();
  const actor = requireCan(user, "dispatch:signoff");

  const tripId = String(formData.get("tripId") ?? "");
  const driverName = String(formData.get("driverName") ?? "").trim();
  const signatureData = String(formData.get("signatureData") ?? "").trim();

  const trip = await prisma.deliveryTrip.findUnique({
    where: { id: tripId },
    include: { lanes: { orderBy: { position: "asc" } } },
  });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "QC_PASSED") throw new Error("Only a QC-passed trip can be signed off.");
  if (!driverName) throw new Error("Enter the driver's name.");
  if (!signatureData) throw new Error("Capture the driver's signature.");

  const primaryLane = trip.lanes[0];
  if (!primaryLane) throw new Error("This trip has no lane to ship from.");

  // What physically ships = net staged qty in the primary lane, per condition.
  const staged = await prisma.inventoryLedger.groupBy({
    by: ["productId", "condition"],
    where: { tripId, locationId: primaryLane.laneId },
    _sum: { qtyDelta: true },
  });
  const toShip = staged
    .map((r) => ({ productId: r.productId, condition: r.condition, qty: r._sum.qtyDelta ?? 0 }))
    .filter((r) => r.qty > 0);
  if (toShip.length === 0) throw new Error("Nothing is staged in the lane to ship.");

  // True COGS snapshot: this is the moment stock leaves, so lock each synced
  // order's line cost at the current main-warehouse average (est COGS was a
  // moving estimate until now). Reads happen before the write transaction.
  const syncedOrders = await prisma.order.findMany({
    where: { deliveryTripId: tripId, source: "NETSUITE" },
    select: { id: true, lines: { select: { id: true, productId: true, qty: true } } },
  });
  const snapshotCosts = syncedOrders.length
    ? await mainWarehouseUnitCosts(
        syncedOrders.flatMap((o) => o.lines.map((l) => l.productId).filter((p): p is string => !!p))
      )
    : new Map<string, number>();

  await prisma.$transaction(async (tx) => {
    for (const { productId, condition, qty } of toShip) {
      await tx.inventoryLedger.create({
        data: {
          productId,
          locationId: primaryLane.laneId,
          condition,
          qtyDelta: -qty,
          reason: "SHIPMENT",
          note: `Departed${trip.name ? ` — ${trip.name}` : ""}`,
          tripId,
          createdById: actor.id,
        },
      });
    }
    await tx.deliveryTrip.update({
      where: { id: tripId },
      data: {
        status: "LOADED",
        // Record the app driver only when the signer is one; a manager signing
        // on their behalf leaves driverId null and keeps the typed driverName.
        driverId: actor.role === "DRIVER" ? actor.id : null,
        driverName,
        signatureData,
        signedAt: new Date(),
        departedAt: new Date(),
      },
    });

    // Lock true COGS on the synced orders that just shipped.
    for (const o of syncedOrders) {
      let trueCogs = 0;
      for (const l of o.lines) {
        const unit = l.productId ? snapshotCosts.get(l.productId) ?? null : null;
        if (unit != null) trueCogs += unit * l.qty;
        await tx.orderLine.update({ where: { id: l.id }, data: { costSnapshotCents: unit } });
      }
      await tx.order.update({ where: { id: o.id }, data: { trueCogsCents: trueCogs } });
    }
  });

  touch(tripId);
}

/** Close out a loaded trip once the customer takes delivery. */
export async function markDelivered(formData: FormData): Promise<void> {
  const user = await getViewer();
  const actor = requireCan(user, "dispatch:signoff");

  const tripId = String(formData.get("tripId") ?? "");
  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "LOADED") throw new Error("Only a loaded trip can be marked delivered.");

  await prisma.deliveryTrip.update({
    where: { id: tripId },
    data: { status: "DELIVERED", deliveredById: actor.id, deliveredAt: new Date() },
  });
  touch(tripId);
}
