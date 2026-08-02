"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clampCheckIn, remainingToCheckIn } from "@/lib/transfers";

export interface ReturnState {
  ok?: boolean;
  message?: string;
}

function paths(id?: string) {
  revalidatePath("/returns");
  if (id) revalidatePath(`/returns/${id}`);
  revalidatePath("/inventory");
}

/** Flag an order/units as coming back to the warehouse. Any authenticated staff. */
export async function createReturn(formData: FormData): Promise<void> {
  const user = await getViewer();
  if (!user) throw new Error("Not authenticated");

  const reference = String(formData.get("reference") ?? "").trim() || null;
  const reason = String(formData.get("reason") ?? "").trim() || null;

  const created = await prisma.returnOrder.create({
    data: { reference, reason, createdById: user.id },
  });
  redirect(`/returns/${created.id}`);
}

export async function addReturnLine(formData: FormData): Promise<void> {
  const user = await getViewer();
  if (!user) throw new Error("Not authenticated");

  const returnOrderId = String(formData.get("returnOrderId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const qty = Math.round(Number(formData.get("qty") ?? 0));
  if (!returnOrderId || !sku || !Number.isFinite(qty) || qty <= 0) return;

  const ret = await prisma.returnOrder.findUnique({ where: { id: returnOrderId } });
  if (!ret || ret.status !== "FLAGGED") throw new Error("This return is already closed.");

  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error(`No product with SKU "${sku}".`);

  await prisma.returnOrderLine.create({
    data: { returnOrderId, productId: product.id, itemLabel: product.sku, expectedQty: qty },
  });
  paths(returnOrderId);
}

export async function removeReturnLine(formData: FormData): Promise<void> {
  const user = await getViewer();
  if (!user) throw new Error("Not authenticated");
  const id = String(formData.get("lineId") ?? "");
  const line = await prisma.returnOrderLine.findUnique({
    where: { id },
    include: { returnOrder: true },
  });
  if (!line) return;
  if (line.returnOrder.status !== "FLAGGED")
    throw new Error("This return is already closed.");
  if (line.checkedInQty > 0)
    throw new Error("This line already has units checked in.");
  await prisma.returnOrderLine.delete({ where: { id } });
  paths(line.returnOrderId);
}

export async function mapReturnLine(formData: FormData): Promise<void> {
  const user = await getViewer();
  if (!user) throw new Error("Not authenticated");
  const id = String(formData.get("lineId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  const line = await prisma.returnOrderLine.findUnique({
    where: { id },
    include: { returnOrder: true },
  });
  if (!line) throw new Error("Line not found.");
  if (line.returnOrder.status !== "FLAGGED")
    throw new Error("This return is already closed.");
  const product = await prisma.product.findUnique({ where: { sku } });
  if (!product) throw new Error(`No product with SKU "${sku}".`);
  await prisma.returnOrderLine.update({
    where: { id },
    data: { productId: product.id },
  });
  paths(line.returnOrderId);
}

/**
 * Check units back into stock. Partial is fine — quantities accumulate per line
 * and anything never returned stays visible as a shortfall.
 */
export async function checkInReturn(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "returns:edit");

  const id = String(formData.get("returnOrderId") ?? "");
  const ret = await prisma.returnOrder.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!ret) throw new Error("Return not found.");
  if (ret.status !== "FLAGGED") throw new Error("This return is already closed.");

  const unmatched = ret.lines.filter((l) => !l.productId).length;
  if (unmatched) throw new Error(`Map ${unmatched} unmatched line(s) first.`);

  await prisma.$transaction(async (tx) => {
    for (const line of ret.lines) {
      const requested = Number(formData.get(`qty_${line.id}`) ?? 0);
      const qty = clampCheckIn(requested, line.expectedQty, line.checkedInQty);
      if (qty <= 0) continue;

      await tx.returnOrderLine.update({
        where: { id: line.id },
        data: { checkedInQty: line.checkedInQty + qty },
      });
      await tx.inventoryLedger.create({
        data: {
          productId: line.productId!,
          locationId: null, // back into Ocoee at warehouse level
          qtyDelta: qty,
          reason: "RETURN",
          note: `Return check-in${ret.reference ? ` — ${ret.reference}` : ""}`,
          returnOrderId: ret.id,
          createdById: user!.id,
        },
      });
    }
  });

  // Auto-close once every line is fully back.
  const after = await prisma.returnOrderLine.findMany({ where: { returnOrderId: id } });
  const allIn = after.every(
    (l) => remainingToCheckIn(l.expectedQty, l.checkedInQty) === 0
  );
  if (allIn && after.length > 0) {
    await prisma.returnOrder.update({
      where: { id },
      data: { status: "CHECKED_IN", checkedInAt: new Date(), checkedInById: user!.id },
    });
  }

  paths(id);
}

/**
 * Close a return even if units are missing — the shortfall (expected vs checked
 * in) stays on record, which is exactly the tradeshow-shrinkage visibility gap.
 */
export async function closeReturn(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "returns:edit");
  const id = String(formData.get("returnOrderId") ?? "");
  const ret = await prisma.returnOrder.findUnique({ where: { id } });
  if (!ret) throw new Error("Return not found.");
  if (ret.status !== "FLAGGED") throw new Error("This return is already closed.");
  await prisma.returnOrder.update({
    where: { id },
    data: { status: "CHECKED_IN", checkedInAt: new Date(), checkedInById: user!.id },
  });
  paths(id);
}

export async function cancelReturn(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "returns:edit");
  const id = String(formData.get("returnOrderId") ?? "");
  const ret = await prisma.returnOrder.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!ret) throw new Error("Return not found.");
  if (ret.status !== "FLAGGED") throw new Error("This return is already closed.");
  if (ret.lines.some((l) => l.checkedInQty > 0))
    throw new Error("Units have already been checked in — close it instead.");
  await prisma.returnOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  paths(id);
}
