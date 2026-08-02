"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { parseSpreadsheet, pickColumn } from "@/lib/spreadsheet";
import type { UploadState } from "@/lib/upload";

/** Add or update one component line on a finished product's BOM. MANAGER/ADMIN. */
export async function addBomComponent(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");

  const productSku = String(formData.get("productSku") ?? "").trim();
  const componentSku = String(formData.get("componentSku") ?? "").trim();
  const qty = Math.round(Number(formData.get("qty") ?? 0));
  if (!productSku || !componentSku || !Number.isFinite(qty) || qty <= 0) return;
  if (productSku === componentSku) throw new Error("A product can't be its own component.");

  const [product, component] = await Promise.all([
    prisma.product.findUnique({ where: { sku: productSku } }),
    prisma.product.findUnique({ where: { sku: componentSku } }),
  ]);
  if (!product) throw new Error(`No product "${productSku}".`);
  if (!component) throw new Error(`No component "${componentSku}".`);

  await prisma.bomComponent.upsert({
    where: {
      productId_componentId: { productId: product.id, componentId: component.id },
    },
    create: { productId: product.id, componentId: component.id, qty },
    update: { qty },
  });
  revalidatePath("/manufacturing/bom");
}

export async function removeBomComponent(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.bomComponent.delete({ where: { id } });
  revalidatePath("/manufacturing/bom");
}

/**
 * Bulk-import BOM lines. Columns (case-insensitive): Parent SKU, Component SKU, Qty.
 */
export async function importBom(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };
  try {
    requireCan(user, "admin.manufacturing:view");
  } catch {
    return { ok: false, message: "Only managers can import BOMs." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .csv or .xlsx file to upload." };
  }
  let sheet;
  try {
    sheet = await parseSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const parentCol = pickColumn(sheet.headers, [
    "Parent SKU",
    "Parent",
    "Base SKU",
    "Product SKU",
    "Product",
    "SKU",
  ]);
  const compCol = pickColumn(sheet.headers, [
    "Component SKU",
    "Component",
    "Raw SKU",
    "Item",
  ]);
  const qtyCol = pickColumn(sheet.headers, ["Qty", "Quantity", "Count"]);
  if (!parentCol || !compCol || !qtyCol) {
    return {
      ok: false,
      message: `Need Parent SKU, Component SKU, and Qty columns. Found: ${sheet.headers.join(", ")}`,
    };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const cache = new Map<string, string | null>();
  async function idFor(sku: string): Promise<string | null> {
    if (cache.has(sku)) return cache.get(sku) ?? null;
    const p = await prisma.product.findUnique({
      where: { sku },
      select: { id: true },
    });
    cache.set(sku, p?.id ?? null);
    return p?.id ?? null;
  }

  for (const [i, row] of sheet.rows.entries()) {
    const parentSku = (row[parentCol] ?? "").trim();
    const compSku = (row[compCol] ?? "").trim();
    const qty = Math.round(Number((row[qtyCol] ?? "").replace(/[, ]/g, "")));
    if (!parentSku || !compSku) {
      skipped++;
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`Row ${i + 2}: invalid Qty`);
      skipped++;
      continue;
    }
    const [pid, cid] = await Promise.all([idFor(parentSku), idFor(compSku)]);
    if (!pid) {
      errors.push(`Row ${i + 2}: no product "${parentSku}"`);
      skipped++;
      continue;
    }
    if (!cid) {
      errors.push(`Row ${i + 2}: no component "${compSku}"`);
      skipped++;
      continue;
    }
    try {
      const existing = await prisma.bomComponent.findUnique({
        where: { productId_componentId: { productId: pid, componentId: cid } },
      });
      await prisma.bomComponent.upsert({
        where: { productId_componentId: { productId: pid, componentId: cid } },
        create: { productId: pid, componentId: cid, qty },
        update: { qty },
      });
      if (existing) updated++;
      else created++;
    } catch (e) {
      errors.push(`Row ${i + 2}: ${(e as Error).message}`);
      skipped++;
    }
  }

  revalidatePath("/manufacturing/bom");
  return {
    ok: true,
    message: `Done. ${created} added, ${updated} updated, ${skipped} skipped.`,
    created,
    updated,
    skipped,
    errors: errors.slice(0, 20),
  };
}
