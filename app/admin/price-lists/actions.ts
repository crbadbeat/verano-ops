"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCan } from "@/lib/rbac";

function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
function intOr(v: FormDataEntryValue | null, dflt: number): number {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) ? n : dflt;
}
function nullable(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

async function requireManage() {
  const user = await getViewer();
  requireCan(user, "admin.pricelists:edit");
}

/** Create a price list option. Name is unique. */
export async function createPriceList(formData: FormData): Promise<void> {
  await requireManage();
  const name = str(formData.get("name"));
  if (!name) return;
  try {
    await prisma.priceList.create({
      data: {
        name,
        abbreviation: nullable(formData.get("abbreviation")),
        sortOrder: intOr(formData.get("sortOrder"), 0),
      },
    });
  } catch {
    // Unique name clash — ignore; the page re-renders with the existing row.
  }
  revalidatePath("/admin/price-lists");
  redirect("/admin/price-lists?saved=1");
}

/** Rename, reorder, or (de)activate a price list. */
export async function updatePriceList(formData: FormData): Promise<void> {
  await requireManage();
  const id = str(formData.get("id"));
  const name = str(formData.get("name"));
  if (!id || !name) return;
  try {
    await prisma.priceList.update({
      where: { id },
      data: {
        name,
        abbreviation: nullable(formData.get("abbreviation")),
        sortOrder: intOr(formData.get("sortOrder"), 0),
        active: formData.get("active") === "on" || formData.get("active") === "1",
      },
    });
  } catch {
    // name clash — ignore
  }
  revalidatePath("/admin/price-lists");
  redirect("/admin/price-lists?saved=1");
}

/** Delete a price list option. Past sales entries keep their text snapshot. */
export async function deletePriceList(formData: FormData): Promise<void> {
  await requireManage();
  const id = str(formData.get("id"));
  if (!id) return;
  await prisma.priceList.delete({ where: { id } });
  revalidatePath("/admin/price-lists");
  redirect("/admin/price-lists?deleted=1");
}
