"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
function nullable(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

async function requireAdmin() {
  const user = await getViewer();
  requireCan(user, "admin.employees:view");
}

/** Create a PGD region. Name is unique. */
export async function createRegion(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = str(formData.get("name"));
  if (!name) return;
  try {
    await prisma.region.create({ data: { name, regionalId: nullable(formData.get("regionalId")) } });
  } catch {
    // Unique name clash — ignore; the form re-renders with the existing region.
  }
  revalidatePath("/admin/regions");
  redirect("/admin/regions?saved=1");
}

/** Rename a region, set its Regional, or (de)activate it. */
export async function updateRegion(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData.get("regionId"));
  const name = str(formData.get("name"));
  if (!id || !name) return;
  try {
    await prisma.region.update({
      where: { id },
      data: {
        name,
        regionalId: nullable(formData.get("regionalId")),
        active: formData.get("active") === "on" || formData.get("active") === "1",
      },
    });
  } catch {
    // name clash — ignore
  }
  revalidatePath("/admin/regions");
  redirect("/admin/regions?saved=1");
}

/**
 * Assign the set of showrooms in a region in one shot: every checked location's
 * regionId is set to this region, and any location currently in the region but
 * unchecked is cleared. Only WAREHOUSE-type locations (showrooms live there).
 */
export async function setRegionShowrooms(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData.get("regionId"));
  if (!id) return;
  const wanted = formData.getAll("locationIds").map(String).filter(Boolean);

  const valid = wanted.length
    ? new Set(
        (
          await prisma.location.findMany({
            where: { id: { in: wanted }, type: "WAREHOUSE" },
            select: { id: true },
          })
        ).map((l) => l.id)
      )
    : new Set<string>();

  await prisma.$transaction([
    // Clear showrooms that were in this region but are no longer checked.
    prisma.location.updateMany({
      where: { regionId: id, id: { notIn: [...valid] } },
      data: { regionId: null },
    }),
    // Set the checked ones to this region.
    prisma.location.updateMany({
      where: { id: { in: [...valid] } },
      data: { regionId: id },
    }),
  ]);
  revalidatePath("/admin/regions");
  redirect("/admin/regions?saved=1");
}
