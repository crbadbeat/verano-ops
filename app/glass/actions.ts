"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { dueDateForLoadDate } from "@/lib/glass";

function paths() {
  revalidatePath("/glass");
  revalidatePath("/inventory");
}

function toUtcDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const flagSchema = z.object({
  orderNo: z.string().optional(),
  customer: z.string().optional(),
  loadDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  sourceSku: z.string().min(1),
  targetSku: z.string().min(1),
  qty: z.coerce.number().int().min(1),
  note: z.string().optional(),
});

/**
 * Flag an order + the glass to cut into a new configuration. Any authenticated
 * staff can queue work. Due date defaults to 2 business days before the load
 * date (overridable).
 */
export async function flagGlassMod(formData: FormData): Promise<void> {
  const user = await getViewer();
  if (!user) throw new Error("Not authenticated");

  const parsed = flagSchema.safeParse({
    orderNo: formData.get("orderNo"),
    customer: formData.get("customer"),
    loadDate: formData.get("loadDate"),
    dueDate: formData.get("dueDate"),
    sourceSku: formData.get("sourceSku"),
    targetSku: formData.get("targetSku"),
    qty: formData.get("qty"),
    note: formData.get("note"),
  });
  if (!parsed.success) throw new Error("Pick the glass to cut, the new config, and a quantity.");
  const d = parsed.data;

  const sourceSku = d.sourceSku.trim();
  const targetSku = d.targetSku.trim();
  if (sourceSku === targetSku)
    throw new Error("The new configuration must differ from the glass being cut.");

  const [source, target] = await Promise.all([
    prisma.product.findUnique({ where: { sku: sourceSku } }),
    prisma.product.findUnique({ where: { sku: targetSku } }),
  ]);
  if (!source) throw new Error(`No product with SKU "${sourceSku}".`);
  if (!target) throw new Error(`No product with SKU "${targetSku}".`);

  const loadDate = d.loadDate ? toUtcDate(d.loadDate) : null;
  const dueDate = d.dueDate
    ? toUtcDate(d.dueDate)
    : loadDate
      ? dueDateForLoadDate(loadDate)
      : null;

  await prisma.glassMod.create({
    data: {
      orderNo: d.orderNo?.trim() || null,
      customer: d.customer?.trim() || null,
      loadDate,
      dueDate,
      sourceProductId: source.id,
      targetProductId: target.id,
      qty: d.qty,
      note: d.note?.trim() || null,
      requestedById: user.id,
    },
  });
  paths();
}

/** Operator picks up the job. */
export async function startGlassMod(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "glass:execute");
  const id = String(formData.get("glassModId") ?? "");
  const job = await prisma.glassMod.findUnique({ where: { id } });
  if (!job) throw new Error("Job not found.");
  if (job.status !== "QUEUED") throw new Error("Only a queued job can be started.");
  await prisma.glassMod.update({
    where: { id },
    data: { status: "IN_PROGRESS", startedAt: new Date() },
  });
  paths();
}

/**
 * Cut complete: deduct the original glass and add the new configuration
 * (warehouse level), both tagged to this job.
 */
export async function completeGlassMod(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "glass:execute");

  const id = String(formData.get("glassModId") ?? "");
  const job = await prisma.glassMod.findUnique({
    where: { id },
    include: { sourceProduct: true, targetProduct: true },
  });
  if (!job) throw new Error("Job not found.");
  if (job.status === "COMPLETED") throw new Error("This job is already complete.");
  if (job.status === "CANCELLED") throw new Error("This job was cancelled.");

  await prisma.$transaction(async (tx) => {
    await tx.inventoryLedger.create({
      data: {
        productId: job.sourceProductId,
        qtyDelta: -job.qty,
        reason: "MOD_OUT",
        note: `Glass mod — cut ${job.sourceProduct.sku}`,
        glassModId: job.id,
        createdById: user!.id,
      },
    });
    await tx.inventoryLedger.create({
      data: {
        productId: job.targetProductId,
        qtyDelta: job.qty,
        reason: "MOD_IN",
        note: `Glass mod — produced ${job.targetProduct.sku}`,
        glassModId: job.id,
        createdById: user!.id,
      },
    });
    await tx.glassMod.update({
      where: { id },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: user!.id },
    });
  });

  paths();
}

export async function cancelGlassMod(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "glass:execute");
  const id = String(formData.get("glassModId") ?? "");
  const job = await prisma.glassMod.findUnique({ where: { id } });
  if (!job) throw new Error("Job not found.");
  if (job.status === "COMPLETED")
    throw new Error("A completed job can't be cancelled.");
  await prisma.glassMod.update({ where: { id }, data: { status: "CANCELLED" } });
  paths();
}
