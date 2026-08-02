"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { bonusShares, explodeBom, centsToUsd } from "@/lib/manufacturing";

export interface RecordState {
  ok?: boolean;
  message?: string;
}

const STAGES = ["WELDING", "BOARDING", "STUCCO", "ELECTRICAL", "WRAPPING"] as const;

function resolveWorkers(
  employee1Id: string,
  split: boolean,
  employee2Id?: string
): { workers: string[]; error?: string } {
  if (split) {
    if (!employee2Id) return { workers: [], error: "Pick the second worker for a split job." };
    if (employee2Id === employee1Id)
      return { workers: [], error: "Pick two different workers." };
    return { workers: [employee1Id, employee2Id] };
  }
  return { workers: [employee1Id] };
}

const jobSchema = z.object({
  productSku: z.string().min(1),
  stage: z.enum(STAGES),
  baseStyleId: z.string().optional(),
  employee1Id: z.string().min(1),
  split: z.string().optional(),
  employee2Id: z.string().optional(),
  note: z.string().optional(),
});

/** Record a passed job: bonus per worker; Wrapping also moves inventory. */
export async function recordJob(
  _prev: RecordState,
  formData: FormData
): Promise<RecordState> {
  const user = await getViewer();
  try {
    requireCan(user, "mfg:record");
  } catch {
    return { ok: false, message: "Not authorized." };
  }

  const parsed = jobSchema.safeParse({
    productSku: formData.get("productSku"),
    stage: formData.get("stage"),
    baseStyleId: formData.get("baseStyleId"),
    employee1Id: formData.get("employee1Id"),
    split: formData.get("split"),
    employee2Id: formData.get("employee2Id"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { ok: false, message: "Scan a base, and pick a stage + worker." };
  const d = parsed.data;
  const split = d.split === "true" || d.split === "on";

  const { workers, error } = resolveWorkers(d.employee1Id, split, d.employee2Id);
  if (error) return { ok: false, message: error };

  const product = await prisma.product.findUnique({
    where: { sku: d.productSku.trim() },
    include: { bomParentOf: true },
  });
  if (!product) return { ok: false, message: `No base with SKU "${d.productSku}".` };

  let rateCents = 0;
  if (d.baseStyleId) {
    const rate = await prisma.bonusRate.findUnique({
      where: { baseStyleId_stage: { baseStyleId: d.baseStyleId, stage: d.stage } },
    });
    rateCents = rate?.amountCents ?? 0;
  }
  const shares = bonusShares(rateCents, workers.length);

  await prisma.$transaction(async (tx) => {
    const entry = await tx.manufacturingEntry.create({
      data: {
        kind: "JOB",
        productId: product.id,
        baseStyleId: d.baseStyleId || null,
        stage: d.stage,
        split,
        bonusRateCents: rateCents,
        note: d.note?.trim() || null,
        createdById: user!.id,
        pays: {
          create: workers.map((employeeId, i) => ({ employeeId, amountCents: shares[i] })),
        },
      },
    });

    if (d.stage === "WRAPPING") {
      // Finished base into stock (warehouse level).
      await tx.inventoryLedger.create({
        data: {
          productId: product.id,
          qtyDelta: 1,
          reason: "MANUFACTURE",
          note: `Wrapped — built ${product.sku}`,
          manufacturingEntryId: entry.id,
          createdById: user!.id,
        },
      });
      // Consume raw goods per the BOM (skips cleanly when no BOM is defined).
      const consume = explodeBom(
        product.bomParentOf.map((b) => ({ componentId: b.componentId, qty: b.qty })),
        1
      );
      for (const c of consume) {
        await tx.inventoryLedger.create({
          data: {
            productId: c.componentId,
            qtyDelta: -c.qty,
            reason: "CONSUME",
            note: `Consumed building ${product.sku}`,
            manufacturingEntryId: entry.id,
            createdById: user!.id,
          },
        });
      }
    }
  });

  revalidatePath("/manufacturing");
  revalidatePath("/manufacturing/entries");
  if (d.stage === "WRAPPING") revalidatePath("/inventory");
  return {
    ok: true,
    message: `Recorded ${d.stage} for ${product.sku}${rateCents ? ` · bonus $${centsToUsd(rateCents)}` : ""}`,
  };
}

const modSchema = z.object({
  stage: z.enum(STAGES),
  baseStyleId: z.string().optional(),
  employee1Id: z.string().min(1),
  split: z.string().optional(),
  employee2Id: z.string().optional(),
  modReasonId: z.string().optional(),
  note: z.string().optional(),
  changeConfig: z.string().optional(),
  originalSku: z.string().optional(),
  newSku: z.string().optional(),
});

/** Record a mod: bonus per worker; optional config swap moves inventory. */
export async function recordMod(
  _prev: RecordState,
  formData: FormData
): Promise<RecordState> {
  const user = await getViewer();
  try {
    requireCan(user, "mfg:record");
  } catch {
    return { ok: false, message: "Not authorized." };
  }

  const parsed = modSchema.safeParse({
    stage: formData.get("stage"),
    baseStyleId: formData.get("baseStyleId"),
    employee1Id: formData.get("employee1Id"),
    split: formData.get("split"),
    employee2Id: formData.get("employee2Id"),
    modReasonId: formData.get("modReasonId"),
    note: formData.get("note"),
    changeConfig: formData.get("changeConfig"),
    originalSku: formData.get("originalSku"),
    newSku: formData.get("newSku"),
  });
  if (!parsed.success) return { ok: false, message: "Pick a stage and worker." };
  const d = parsed.data;
  const split = d.split === "true" || d.split === "on";
  const changeConfig = d.changeConfig === "true" || d.changeConfig === "on";

  const { workers, error } = resolveWorkers(d.employee1Id, split, d.employee2Id);
  if (error) return { ok: false, message: error };

  let originalProduct = null;
  let newProduct = null;
  if (changeConfig) {
    const oSku = (d.originalSku ?? "").trim();
    const nSku = (d.newSku ?? "").trim();
    if (!oSku || !nSku)
      return { ok: false, message: "A config change needs both the original and new SKU." };
    [originalProduct, newProduct] = await Promise.all([
      prisma.product.findUnique({ where: { sku: oSku } }),
      prisma.product.findUnique({ where: { sku: nSku } }),
    ]);
    if (!originalProduct) return { ok: false, message: `No product "${oSku}".` };
    if (!newProduct) return { ok: false, message: `No product "${nSku}".` };
  }

  let rateCents = 0;
  if (d.baseStyleId) {
    const rate = await prisma.bonusRate.findUnique({
      where: { baseStyleId_stage: { baseStyleId: d.baseStyleId, stage: d.stage } },
    });
    rateCents = rate?.amountCents ?? 0;
  }
  const shares = bonusShares(rateCents, workers.length);

  await prisma.$transaction(async (tx) => {
    const entry = await tx.manufacturingEntry.create({
      data: {
        kind: "MOD",
        productId: originalProduct?.id ?? null,
        newProductId: newProduct?.id ?? null,
        baseStyleId: d.baseStyleId || null,
        stage: d.stage,
        modReasonId: d.modReasonId || null,
        split,
        bonusRateCents: rateCents,
        note: d.note?.trim() || null,
        createdById: user!.id,
        pays: {
          create: workers.map((employeeId, i) => ({ employeeId, amountCents: shares[i] })),
        },
      },
    });

    if (changeConfig && originalProduct && newProduct) {
      await tx.inventoryLedger.create({
        data: {
          productId: originalProduct.id,
          qtyDelta: -1,
          reason: "MOD_OUT",
          note: `Mod — deducted ${originalProduct.sku}`,
          manufacturingEntryId: entry.id,
          createdById: user!.id,
        },
      });
      await tx.inventoryLedger.create({
        data: {
          productId: newProduct.id,
          qtyDelta: 1,
          reason: "MOD_IN",
          note: `Mod — added ${newProduct.sku}`,
          manufacturingEntryId: entry.id,
          createdById: user!.id,
        },
      });
    }
  });

  revalidatePath("/manufacturing");
  revalidatePath("/manufacturing/entries");
  if (changeConfig) revalidatePath("/inventory");
  return {
    ok: true,
    message: `Recorded mod${rateCents ? ` · bonus $${centsToUsd(rateCents)}` : ""}`,
  };
}

/**
 * Void an entry (correction): write compensating REVERSAL rows for anything it
 * moved in inventory, and mark it voided so payroll excludes its bonus. The
 * append-only ledger stays intact — nothing is deleted. Editing = void + re-enter.
 */
export async function voidEntry(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "mfg:record");

  const id = String(formData.get("entryId") ?? "");
  const entry = await prisma.manufacturingEntry.findUnique({
    where: { id },
    include: { ledgerEntries: true },
  });
  if (!entry) throw new Error("Entry not found.");
  if (entry.voided) return;

  await prisma.$transaction(async (tx) => {
    for (const l of entry.ledgerEntries) {
      if (l.qtyDelta === 0) continue;
      await tx.inventoryLedger.create({
        data: {
          productId: l.productId,
          locationId: l.locationId,
          qtyDelta: -l.qtyDelta,
          reason: "REVERSAL",
          note: "Voided manufacturing entry",
          manufacturingEntryId: entry.id,
          createdById: user!.id,
        },
      });
    }
    await tx.manufacturingEntry.update({
      where: { id },
      data: { voided: true, voidedById: user!.id, voidedAt: new Date() },
    });
  });

  revalidatePath("/manufacturing/entries");
  revalidatePath("/inventory");
}
