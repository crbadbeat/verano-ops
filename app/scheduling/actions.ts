"use server";

import { redirect } from "next/navigation";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { logOrderEvent } from "@/lib/orders";
import { onHandByProduct } from "@/lib/inventory";
import { computeShortfalls } from "@/lib/scheduling";
import { productDisplayName } from "@/lib/item-master";
import { dueDateForLoadDate } from "@/lib/glass";
import { getMinDepositBps } from "@/lib/settings";
import { depositGate, depositPctString } from "@/lib/deposit";
import type { OrderType } from "@prisma/client";

function toUtcDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Revalidate the surfaces a scheduling change touches. */
function touch(opts: { tripId?: string; orderId?: string } = {}) {
  revalidatePath("/scheduling");
  if (opts.tripId) revalidatePath(`/scheduling/trips/${opts.tripId}`);
  if (opts.orderId) revalidatePath(`/orders/${opts.orderId}`);
  revalidatePath("/orders");
  revalidatePath("/glass/demand");
}

// ---- building a trip --------------------------------------------------------

const createSchema = z.object({
  loadDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a load date."),
  type: z.enum(["CUSTOMER_DELIVERY", "TRANSFER", "SHOW"]).default("CUSTOMER_DELIVERY"),
  name: z.string().optional(),
  area: z.string().optional(),
});

export async function createTrip(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "scheduling:edit");

  const parsed = createSchema.safeParse({
    loadDate: formData.get("loadDate"),
    type: formData.get("type") || undefined,
    name: formData.get("name"),
    area: formData.get("area"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid trip.");
  const d = parsed.data;

  const trip = await prisma.deliveryTrip.create({
    data: {
      loadDate: toUtcDate(d.loadDate),
      type: d.type as OrderType,
      name: d.name?.trim() || null,
      area: d.area?.trim() || null,
      createdById: user!.id,
    },
  });

  revalidatePath("/scheduling");
  redirect(`/scheduling/trips/${trip.id}`);
}

export async function updateTrip(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "scheduling:edit");

  const tripId = String(formData.get("tripId") ?? "");
  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");

  const name = String(formData.get("name") ?? "").trim();
  const area = String(formData.get("area") ?? "").trim();
  const loadRaw = String(formData.get("loadDate") ?? "").trim();
  const newLoadDate = /^\d{4}-\d{2}-\d{2}$/.test(loadRaw) ? toUtcDate(loadRaw) : null;

  await prisma.deliveryTrip.update({
    where: { id: tripId },
    data: {
      name: name || null,
      area: area || null,
      ...(newLoadDate ? { loadDate: newLoadDate } : {}),
    },
  });

  // Moving the trip moves its orders' load dates with it.
  if (newLoadDate && newLoadDate.getTime() !== trip.loadDate.getTime()) {
    await prisma.order.updateMany({
      where: { deliveryTripId: tripId },
      data: { loadDate: newLoadDate },
    });
    const orders = await prisma.order.findMany({
      where: { deliveryTripId: tripId },
      select: { id: true },
    });
    for (const o of orders) {
      await logOrderEvent(o.id, "RESCHEDULED", `Load date moved to ${isoOf(newLoadDate)}`, user!.id);
    }
  }

  touch({ tripId });
}

export async function finalizeTrip(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "scheduling:edit");

  const tripId = String(formData.get("tripId") ?? "");
  const trip = await prisma.deliveryTrip.findUnique({
    where: { id: tripId },
    include: { _count: { select: { orders: true } } },
  });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "PLANNING") throw new Error("Only a trip being planned can be finalized.");
  if (trip._count.orders === 0) throw new Error("Add at least one order before finalizing.");

  await prisma.deliveryTrip.update({
    where: { id: tripId },
    data: { status: "FINALIZED", finalizedAt: new Date() },
  });
  touch({ tripId });
}

export async function unfinalizeTrip(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "scheduling:edit");

  const tripId = String(formData.get("tripId") ?? "");
  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status !== "FINALIZED") throw new Error("Only a finalized trip can be re-opened.");

  // Section 1: nothing downstream has happened yet, so this is always safe.
  await prisma.deliveryTrip.update({
    where: { id: tripId },
    data: { status: "PLANNING", finalizedAt: null },
  });
  touch({ tripId });
}

export async function cancelTrip(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "scheduling:edit");

  const tripId = String(formData.get("tripId") ?? "");
  const trip = await prisma.deliveryTrip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error("Trip not found.");
  if (trip.status === "CANCELLED") return;

  const orders = await prisma.order.findMany({
    where: { deliveryTripId: tripId },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.order.updateMany({
      where: { deliveryTripId: tripId },
      data: { deliveryTripId: null, status: "CONFIRMED", loadDate: null },
    }),
    prisma.deliveryTrip.update({ where: { id: tripId }, data: { status: "CANCELLED" } }),
  ]);
  for (const o of orders) {
    await logOrderEvent(o.id, "UNSCHEDULED", `Trip cancelled — order returned to Confirmed`, user!.id);
  }
  touch({ tripId });
  redirect("/scheduling");
}

// ---- scheduling orders onto a trip ------------------------------------------

/**
 * Put a confirmed order on a trip. The order takes the trip's load date and moves
 * to SCHEDULED. If the order's finished goods can't cover the load date the CSR
 * may still schedule it, but must record a reason — a soft gate, logged on the
 * order (the trip page renders that note field as required when it is short).
 */
export async function assignOrder(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "scheduling:edit");

  const tripId = String(formData.get("tripId") ?? "");
  const orderId = String(formData.get("orderId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const [trip, order] = await Promise.all([
    prisma.deliveryTrip.findUnique({ where: { id: tripId } }),
    prisma.order.findUnique({
      where: { id: orderId },
      include: {
        lines: { include: { product: { select: { pickable: true, sku: true, displayName: true, name: true } } } },
      },
    }),
  ]);
  if (!trip) throw new Error("Trip not found.");
  if (!order) throw new Error("Order not found.");
  if (trip.status !== "PLANNING") throw new Error("This trip is no longer open for changes.");
  if (order.deliveryTripId === tripId) return; // already here
  if (!["CONFIRMED", "SCHEDULED"].includes(order.status)) {
    throw new Error("Only a confirmed order can be scheduled.");
  }
  // Hard deposit gate: a NetSuite-synced order must have met the minimum deposit
  // before it can go on a trip. Fails open only when deposits aren't synced yet.
  if (order.source === "NETSUITE") {
    const bps = await getMinDepositBps();
    const gate = depositGate(order.depositReceivedCents, order.totalCents, bps);
    if (!gate.met) {
      const pct = gate.pctBps != null ? Math.floor(gate.pctBps / 100) : 0;
      throw new Error(
        `Order ${order.orderNo} needs ${depositPctString(bps)}% down before scheduling (currently ${pct}%).`
      );
    }
  }
  if (order.type !== trip.type) {
    throw new Error(`This is a ${trip.type} trip; order ${order.orderNo} is ${order.type}.`);
  }

  // Point-in-time availability of this order's pickable, resolved lines.
  const pickLines = order.lines
    .filter((l) => l.productId && l.product?.pickable)
    .map((l) => ({
      productId: l.productId as string,
      sku: l.product?.sku ?? l.sku ?? null,
      label: l.product ? productDisplayName(l.product) : l.rawLabel ?? l.sku ?? "item",
      qty: l.qty,
    }));
  const onHand = await onHandByProduct();
  const shortfalls = computeShortfalls(pickLines, onHand);

  // Warn-but-allow: a shortfall OR an open fraud check needs a recorded reason.
  const needsNote = shortfalls.length > 0 || order.fraudCheckStatus === "REQUIRED";
  if (needsNote && !note) {
    throw new Error(
      "This order needs a reason to schedule (short stock or an open fraud check).",
    );
  }

  const moving = !!order.deliveryTripId && order.deliveryTripId !== tripId;
  await prisma.order.update({
    where: { id: orderId },
    data: { deliveryTripId: tripId, status: "SCHEDULED", loadDate: trip.loadDate },
  });

  const summary = `Scheduled onto trip ${trip.name ?? isoOf(trip.loadDate)} (${isoOf(trip.loadDate)})${
    moving ? " — moved from another trip" : ""
  }`;
  await logOrderEvent(orderId, "SCHEDULED", summary, user!.id, {
    tripId,
    loadDate: isoOf(trip.loadDate),
    note: note || null,
    shortfalls: shortfalls.map((s) => ({ sku: s.sku, needed: s.needed, onHand: s.onHand })),
  });

  touch({ tripId, orderId });
}

export async function unassignOrder(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "scheduling:edit");

  const orderId = String(formData.get("orderId") ?? "");
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, deliveryTripId: true },
  });
  if (!order || !order.deliveryTripId) return;
  const tripId = order.deliveryTripId;

  await prisma.order.update({
    where: { id: orderId },
    data: { deliveryTripId: null, status: "CONFIRMED", loadDate: null },
  });
  await logOrderEvent(orderId, "UNSCHEDULED", "Removed from trip — back to Confirmed", user!.id);
  touch({ tripId, orderId });
}

// ---- glass: create a cut job from a scheduled order -------------------------

/**
 * Queue the waterjet to cut one island's top from its blank. Surfaced on the trip
 * for a top that isn't already stocked; the CSR clicks to create it (we never
 * auto-create — a blank is fungible until someone commits it). Mirrors the
 * GlassMod create in app/glass/actions.ts.
 */
export async function createGlassCutJob(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "scheduling:edit");

  const islandId = String(formData.get("islandId") ?? "");
  const island = await prisma.orderIsland.findUnique({
    where: { id: islandId },
    include: {
      order: { select: { orderNo: true, customerLast: true, customerFirst: true, loadDate: true } },
    },
  });
  if (!island) throw new Error("Island not found.");
  if (!island.topBlankSku) throw new Error("This top has no blank recorded to cut from.");

  const source = await prisma.product.findUnique({ where: { sku: island.topBlankSku } });
  if (!source) throw new Error(`The blank ${island.topBlankSku} is not a product here.`);

  // The cut top — prefer the resolved product, else resolve the composed SKU.
  const targetId =
    island.topProductId ??
    (island.topSku
      ? (await prisma.product.findUnique({ where: { sku: island.topSku } }))?.id ?? null
      : null);
  if (!targetId) throw new Error("The cut top is not a product here yet.");

  const loadDate = island.order.loadDate;
  const customer =
    [island.order.customerFirst, island.order.customerLast].filter(Boolean).join(" ") || null;

  // Don't double-queue the same cut for the same order.
  const existing = await prisma.glassMod.findFirst({
    where: {
      orderNo: island.order.orderNo,
      sourceProductId: source.id,
      targetProductId: targetId,
      status: { in: ["QUEUED", "IN_PROGRESS"] },
    },
    select: { id: true },
  });
  if (existing) throw new Error("A cut job for this top is already queued.");

  await prisma.glassMod.create({
    data: {
      orderNo: island.order.orderNo,
      customer,
      loadDate,
      dueDate: loadDate ? dueDateForLoadDate(loadDate) : null,
      sourceProductId: source.id,
      targetProductId: targetId,
      qty: 1,
      requestedById: user!.id,
    },
  });

  revalidatePath("/glass");
  revalidatePath("/glass/demand");
  const tripId = String(formData.get("tripId") ?? "");
  if (tripId) revalidatePath(`/scheduling/trips/${tripId}`);
}
