"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { onHandByProductLocation, productLocationKey } from "@/lib/inventory";
import { findLocationByCode } from "@/lib/locations";
import { clampCheckIn } from "@/lib/transfers";

function touch(tripId?: string) {
  revalidatePath("/staging");
  if (tripId) revalidatePath(`/staging/${tripId}`);
  revalidatePath("/inventory");
}

// ---- lane assignment (manager) ----------------------------------------------

/** Issue a finalized trip its staging lane(s). First = primary = where stock goes. */
export async function assignLanes(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "staging:assign");

  const tripId = String(formData.get("tripId") ?? "");
  const laneIds = [...new Set(formData.getAll("laneId").map(String).filter(Boolean))].slice(0, 3);

  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "FINALIZED" && trip.status !== "STAGING") {
    throw new Error("Only a finalized trip can be given lanes.");
  }
  if (laneIds.length === 0) throw new Error("Pick at least one lane.");

  const lanes = await prisma.location.findMany({
    where: { id: { in: laneIds }, isStagingLane: true },
    select: { id: true },
  });
  if (lanes.length !== laneIds.length) throw new Error("One of those is not a staging lane.");

  await prisma.$transaction(async (tx) => {
    await tx.deliveryTripLane.deleteMany({ where: { tripId } });
    await tx.deliveryTripLane.createMany({
      data: laneIds.map((laneId, i) => ({ tripId, laneId, position: i })),
    });
    if (trip.status === "FINALIZED") {
      await tx.deliveryTrip.update({ where: { id: tripId }, data: { status: "STAGING" } });
    }
  });
  touch(tripId);
}

// ---- the pick (scan → bin→lane move) ----------------------------------------

export interface PickState {
  ok?: boolean;
  message?: string;
}

/**
 * Record one scanned pick: move qty of the item from the scanned source bin into
 * the trip's primary lane. A -qty/+qty PICK pair — total on-hand is conserved,
 * per-location on-hand moves. Clamped so it never over-picks a bin or over-stages
 * the trip. Depletion out of the warehouse waits for driver sign-off.
 */
export async function recordPick(_prev: PickState, formData: FormData): Promise<PickState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };
  try {
    requireCan(user, "staging:pick");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const tripId = String(formData.get("tripId") ?? "");
  const locationCode = String(formData.get("locationCode") ?? "").trim();
  const productIdIn = String(formData.get("productId") ?? "").trim();
  const scanned = String(formData.get("scanned") ?? "").trim(); // raw SKU or barcode
  const qty = Math.round(Number(formData.get("qty") ?? 0));

  if (!tripId) return { ok: false, message: "No trip." };
  if (!locationCode) return { ok: false, message: "Scan the source bin first." };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, message: "Enter a quantity of 1 or more." };

  const trip = await prisma.deliveryTrip.findUnique({
    where: { id: tripId },
    include: { lanes: { orderBy: { position: "asc" } } },
  });
  if (!trip) return { ok: false, message: "Trip not found." };
  if (trip.status !== "STAGING") return { ok: false, message: "This trip is not open for picking." };
  const primaryLane = trip.lanes[0];
  if (!primaryLane) return { ok: false, message: "Assign a lane before picking." };

  const bin = await findLocationByCode(locationCode);
  if (!bin) return { ok: false, message: `Unknown location "${locationCode}".` };
  if (bin.isStagingLane) return { ok: false, message: "Pick from a storage bin, not a lane." };

  // Item: explicit id, else the scanned SKU (Base/Glass QR), else the barcode.
  let product = productIdIn
    ? await prisma.product.findUnique({ where: { id: productIdIn } })
    : null;
  if (!product && scanned) {
    product =
      (await prisma.product.findUnique({ where: { sku: scanned } })) ??
      (await prisma.product.findUnique({ where: { barcode: scanned } }));
  }
  if (!product) {
    return { ok: false, message: scanned ? `No product matches "${scanned}".` : "Scan or pick an item." };
  }

  // Needed on this trip (pickable order lines for the product).
  const need = await prisma.orderLine.aggregate({
    _sum: { qty: true },
    where: { order: { deliveryTripId: tripId }, productId: product.id, product: { pickable: true } },
  });
  const needed = need._sum.qty ?? 0;
  if (needed === 0) return { ok: false, message: `${product.sku} isn't on this trip's pick list.` };

  // Already staged for this trip = net ledger at the trip's lane(s).
  const laneIds = trip.lanes.map((l) => l.laneId);
  const stagedAgg = await prisma.inventoryLedger.aggregate({
    _sum: { qtyDelta: true },
    where: { tripId, productId: product.id, locationId: { in: laneIds } },
  });
  const alreadyStaged = stagedAgg._sum.qtyDelta ?? 0;

  const room = clampCheckIn(qty, needed, alreadyStaged);
  if (room <= 0) return { ok: false, message: `${product.sku} is already fully staged.` };

  // The bin must actually hold it (NEW stock).
  const onHand = await onHandByProductLocation([product.id]);
  const inBin = onHand.get(productLocationKey(product.id, bin.id, "NEW")) ?? 0;
  const pickQty = Math.min(room, inBin);
  if (pickQty <= 0) return { ok: false, message: `No ${product.sku} on hand in ${bin.code}.` };

  await prisma.$transaction([
    prisma.inventoryLedger.create({
      data: {
        productId: product.id,
        locationId: bin.id,
        condition: "NEW",
        qtyDelta: -pickQty,
        reason: "PICK",
        note: `Picked ${product.sku} from ${bin.code}`,
        tripId,
        createdById: user.id,
      },
    }),
    prisma.inventoryLedger.create({
      data: {
        productId: product.id,
        locationId: primaryLane.laneId,
        condition: "NEW",
        qtyDelta: pickQty,
        reason: "PICK",
        note: `Staged ${product.sku} to lane`,
        tripId,
        createdById: user.id,
      },
    }),
  ]);

  touch(tripId);
  const partial = pickQty < qty ? ` — only ${pickQty} in that bin` : "";
  return { ok: true, message: `Picked ${pickQty} × ${product.sku} from ${bin.code}${partial}` };
}

/** Undo the most recent pick for a trip (a mis-scan) — compensating REVERSAL rows. */
export async function undoLastPick(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "staging:pick");

  const tripId = String(formData.get("tripId") ?? "");
  const lastIn = await prisma.inventoryLedger.findFirst({
    where: { tripId, reason: "PICK", qtyDelta: { gt: 0 } },
    orderBy: { createdAt: "desc" },
  });
  if (!lastIn) throw new Error("Nothing to undo.");
  const lastOut = await prisma.inventoryLedger.findFirst({
    where: { tripId, reason: "PICK", qtyDelta: { lt: 0 }, productId: lastIn.productId },
    orderBy: { createdAt: "desc" },
  });

  await prisma.$transaction([
    prisma.inventoryLedger.create({
      data: {
        productId: lastIn.productId,
        locationId: lastIn.locationId,
        condition: lastIn.condition,
        qtyDelta: -lastIn.qtyDelta,
        reason: "REVERSAL",
        note: "Undo pick — off the lane",
        tripId,
        createdById: user!.id,
      },
    }),
    ...(lastOut
      ? [
          prisma.inventoryLedger.create({
            data: {
              productId: lastOut.productId,
              locationId: lastOut.locationId,
              condition: lastOut.condition,
              qtyDelta: -lastOut.qtyDelta,
              reason: "REVERSAL",
              note: "Undo pick — back to the bin",
              tripId,
              createdById: user!.id,
            },
          }),
        ]
      : []),
  ]);
  touch(tripId);
}

// ---- stage completion -------------------------------------------------------

/** Mark a trip staged and ready for QC. Allowed with a shortfall (it stays visible). */
export async function markStaged(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "staging:pick");

  const tripId = String(formData.get("tripId") ?? "");
  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "STAGING") throw new Error("Only a trip being staged can be marked staged.");

  await prisma.deliveryTrip.update({
    where: { id: tripId },
    data: { status: "STAGED", stagedAt: new Date(), stagedById: user!.id },
  });
  touch(tripId);
}

/** Re-open a staged trip for more picking (nothing downstream has happened yet). */
export async function reopenStaging(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "staging:assign");

  const tripId = String(formData.get("tripId") ?? "");
  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "STAGED") throw new Error("Only a staged trip can be reopened.");

  await prisma.deliveryTrip.update({
    where: { id: tripId },
    data: { status: "STAGING", stagedAt: null, stagedById: null },
  });
  touch(tripId);
}
