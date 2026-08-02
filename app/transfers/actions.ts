"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureInTransit } from "@/lib/locations";

export interface TransferState {
  ok?: boolean;
  message?: string;
}

function paths(id?: string) {
  revalidatePath("/transfers");
  if (id) revalidatePath(`/transfers/${id}`);
  revalidatePath("/inventory");
}

/** Open a new staged transfer to a destination warehouse. MANAGER/ADMIN. */
export async function createTransfer(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "transfers:edit");

  const destWarehouseId = String(formData.get("destWarehouseId") ?? "");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  if (!destWarehouseId) throw new Error("Choose a destination warehouse.");

  const dest = await prisma.location.findUnique({ where: { id: destWarehouseId } });
  if (!dest || dest.type !== "WAREHOUSE") throw new Error("Invalid destination.");

  const transfer = await prisma.transfer.create({
    data: { destWarehouseId, reference, createdById: user!.id },
  });
  redirect(`/transfers/${transfer.id}`);
}

/** Add one line by SKU. MANAGER/ADMIN, staged only. */
export async function addTransferLine(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "transfers:edit");

  const transferId = String(formData.get("transferId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const qty = Math.round(Number(formData.get("qty") ?? 0));
  if (!transferId || !sku || !Number.isFinite(qty) || qty <= 0) return;

  const transfer = await prisma.transfer.findUnique({ where: { id: transferId } });
  if (!transfer || transfer.status !== "STAGED")
    throw new Error("Only a staged transfer can be edited.");

  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error(`No product with SKU "${sku}".`);

  await prisma.transferLine.create({
    data: { transferId, productId: product.id, itemLabel: product.sku, qty },
  });
  paths(transferId);
}

export async function removeTransferLine(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "transfers:edit");
  const id = String(formData.get("lineId") ?? "");
  const line = await prisma.transferLine.findUnique({
    where: { id },
    include: { transfer: true },
  });
  if (!line) return;
  if (line.transfer.status !== "STAGED")
    throw new Error("Only a staged transfer can be edited.");
  await prisma.transferLine.delete({ where: { id } });
  paths(line.transferId);
}

/** Attach an unmatched line to a product by SKU. */
export async function mapTransferLine(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "transfers:edit");
  const id = String(formData.get("lineId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const line = await prisma.transferLine.findUnique({
    where: { id },
    include: { transfer: true },
  });
  if (!line) throw new Error("Line not found.");
  if (line.transfer.status !== "STAGED")
    throw new Error("Only a staged transfer can be edited.");
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error(`No product with SKU "${sku}".`);
  await prisma.transferLine.update({
    where: { id },
    data: { productId: product.id },
  });
  paths(line.transferId);
}

/**
 * Depart: QC + driver sign-off, then move stock Ocoee (warehouse level) ->
 * IN-TRANSIT. Blocked while any line is unmatched so nothing moves silently.
 */
export async function departTransfer(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "transfers:edit");

  const id = String(formData.get("transferId") ?? "");
  const driverName = String(formData.get("driverName") ?? "").trim();
  const signatureData = String(formData.get("signatureData") ?? "").trim();

  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!transfer) throw new Error("Transfer not found.");
  if (transfer.status !== "STAGED") throw new Error("This transfer already departed.");
  if (transfer.lines.length === 0) throw new Error("Add at least one line first.");
  if (!driverName) throw new Error("Enter the driver's name.");
  if (!signatureData) throw new Error("Capture the driver's signature.");

  const unmatched = transfer.lines.filter((l) => !l.productId).length;
  if (unmatched) throw new Error(`Map ${unmatched} unmatched line(s) before departing.`);

  const inTransit = await ensureInTransit();

  await prisma.$transaction(async (tx) => {
    for (const l of transfer.lines) {
      if (!l.productId || l.qty <= 0) continue;
      // Out of Ocoee (warehouse level = null location)
      await tx.inventoryLedger.create({
        data: {
          productId: l.productId,
          locationId: null,
          qtyDelta: -l.qty,
          reason: "TRANSFER_OUT",
          note: `Transfer departed${transfer.reference ? ` — ${transfer.reference}` : ""}`,
          transferId: transfer.id,
          createdById: user!.id,
        },
      });
      // Into the virtual in-transit location
      await tx.inventoryLedger.create({
        data: {
          productId: l.productId,
          locationId: inTransit.id,
          qtyDelta: l.qty,
          reason: "TRANSFER_IN",
          note: `In transit${transfer.reference ? ` — ${transfer.reference}` : ""}`,
          transferId: transfer.id,
          createdById: user!.id,
        },
      });
    }
    await tx.transfer.update({
      where: { id },
      data: {
        status: "IN_TRANSIT",
        driverName,
        signatureData,
        signedAt: new Date(),
        departedAt: new Date(),
      },
    });
  });

  paths(id);
}

/** Receive at the destination: IN-TRANSIT -> destination warehouse. */
export async function receiveTransfer(formData: FormData): Promise<void> {
  const user = await getViewer();
  if (!user) throw new Error("Not authenticated");

  const id = String(formData.get("transferId") ?? "");
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: true, destWarehouse: true },
  });
  if (!transfer) throw new Error("Transfer not found.");
  if (transfer.status !== "IN_TRANSIT")
    throw new Error("Only an in-transit transfer can be received.");

  const inTransit = await ensureInTransit();

  await prisma.$transaction(async (tx) => {
    for (const l of transfer.lines) {
      if (!l.productId || l.qty <= 0) continue;
      await tx.inventoryLedger.create({
        data: {
          productId: l.productId,
          locationId: inTransit.id,
          qtyDelta: -l.qty,
          reason: "TRANSFER_OUT",
          note: `Received at ${transfer.destWarehouse.code}`,
          transferId: transfer.id,
          createdById: user.id,
        },
      });
      await tx.inventoryLedger.create({
        data: {
          productId: l.productId,
          locationId: transfer.destWarehouseId,
          qtyDelta: l.qty,
          reason: "TRANSFER_IN",
          note: `Received at ${transfer.destWarehouse.code}`,
          transferId: transfer.id,
          createdById: user.id,
        },
      });
    }
    await tx.transfer.update({
      where: { id },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedById: user.id },
    });
  });

  paths(id);
}

/** Cancel a transfer that hasn't departed (nothing has moved yet). */
export async function cancelTransfer(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "transfers:edit");
  const id = String(formData.get("transferId") ?? "");
  const transfer = await prisma.transfer.findUnique({ where: { id } });
  if (!transfer) throw new Error("Transfer not found.");
  if (transfer.status !== "STAGED")
    throw new Error("Only a staged transfer can be cancelled.");
  await prisma.transfer.update({ where: { id }, data: { status: "CANCELLED" } });
  paths(id);
}
