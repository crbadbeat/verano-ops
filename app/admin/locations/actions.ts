"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { parseSpreadsheet, pickColumn } from "@/lib/spreadsheet";
import { normalizeLocationCode, parseLocationCode } from "@/lib/location-code";
import type { UploadState } from "@/lib/upload";

// Location CRUD, re-homed from /locations to /admin/locations. Logic unchanged;
// only the revalidate targets and the shared UploadState import moved.

/** Create or rename a warehouse (top-level location). MANAGER/ADMIN only. */
export async function createWarehouse(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.locations:edit");

  const code = normalizeLocationCode(String(formData.get("code") ?? ""));
  const name = String(formData.get("name") ?? "").trim() || code;
  if (!code) return;

  await prisma.location.upsert({
    where: { code },
    create: { code, name, type: "WAREHOUSE" },
    update: { name, type: "WAREHOUSE" },
  });
  revalidatePath("/admin/locations");
}

/**
 * Rename a warehouse's display name (the secondary, human-facing name — `code`
 * stays the scannable identity that mirrors NetSuite). MANAGER/ADMIN only.
 */
export async function editWarehouse(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.locations:edit");

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  await prisma.location.update({ where: { id }, data: { name } });
  revalidatePath("/admin/locations");
  revalidatePath("/inventory");
}

/**
 * Flip a warehouse's overhead-exempt flag. Exempt warehouses value stock at the
 * raw NetSuite average (no landed-cost overhead added). MANAGER/ADMIN only.
 */
export async function toggleOverheadExempt(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.locations:edit");

  const id = String(formData.get("id") ?? "");
  const exempt = String(formData.get("exempt") ?? "") === "true";
  if (!id) return;

  await prisma.location.update({ where: { id }, data: { overheadExempt: !exempt } });
  revalidatePath("/admin/locations");
  revalidatePath("/inventory");
}

/** Create or update a bin under a warehouse. MANAGER/ADMIN only. */
export async function createBin(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.locations:edit");

  const warehouseId = String(formData.get("warehouseId") ?? "");
  const code = normalizeLocationCode(String(formData.get("code") ?? ""));
  const name = String(formData.get("name") ?? "").trim() || code;
  if (!warehouseId || !code) return;

  const parts = parseLocationCode(code);
  await prisma.location.upsert({
    where: { code },
    create: { code, name, type: "BIN", parentId: warehouseId, ...parts },
    update: { name, type: "BIN", parentId: warehouseId, ...parts },
  });
  revalidatePath("/admin/locations");
}

/** Flip a location's active flag. MANAGER/ADMIN only. */
export async function toggleLocationActive(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.locations:edit");

  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;

  await prisma.location.update({ where: { id }, data: { active: !active } });
  revalidatePath("/admin/locations");
}

/**
 * Bulk-import bins for a warehouse from a spreadsheet.
 * Expected columns (case-insensitive): Code (bin code), optional Name.
 */
export async function importBins(
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const user = await getViewer();
  if (!user) return { ok: false, message: "Not authenticated" };
  try {
    requireCan(user, "admin.locations:edit");
  } catch {
    return { ok: false, message: "Only managers can import locations." };
  }

  const warehouseId = String(formData.get("warehouseId") ?? "");
  if (!warehouseId) return { ok: false, message: "Choose a warehouse first." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a .csv or .xlsx file to upload." };
  }

  let sheet;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    sheet = await parseSpreadsheet(buffer, file.name);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const codeCol = pickColumn(sheet.headers, [
    "Code",
    "Bin",
    "Bins",
    "Bin Code",
    "Location",
    "Location Code",
  ]);
  const nameCol = pickColumn(sheet.headers, ["Name", "Description", "Label"]);
  if (!codeCol) {
    return {
      ok: false,
      message: `Need a Code column. Found: ${sheet.headers.join(", ")}`,
    };
  }

  let skipped = 0;
  const errors: string[] = [];
  const unstructured: string[] = [];
  const seen = new Set<string>();
  const bins: {
    code: string;
    name: string;
    aisle: string | null;
    bay: string | null;
    level: number | null;
  }[] = [];

  for (const row of sheet.rows) {
    const raw = (row[codeCol] ?? "").trim();
    const code = normalizeLocationCode(raw);
    if (!code) {
      skipped++;
      continue;
    }
    if (seen.has(code)) {
      skipped++; // the sheet listed it twice
      continue;
    }
    seen.add(code);

    const parts = parseLocationCode(code);
    if (!parts.aisle) unstructured.push(code);
    // Keep the sheet's own casing as the display name ("Crate City-Floor").
    bins.push({
      code,
      name: (nameCol && row[nameCol]?.trim()) || raw || code,
      ...parts,
    });
  }

  // One query rather than a lookup per row — these sheets run to four figures.
  const existing = await prisma.location.findMany({
    where: { code: { in: bins.map((b) => b.code) } },
    select: { code: true, name: true, aisle: true, bay: true, level: true, parentId: true },
  });
  const existingByCode = new Map(existing.map((e) => [e.code, e]));

  const toCreate = bins.filter((b) => !existingByCode.has(b.code));
  // Only rewrite rows that would actually change. A re-upload of the same sheet
  // should be a no-op, not 1200 round trips — which is slow enough to time out.
  const toUpdate = bins.filter((b) => {
    const e = existingByCode.get(b.code);
    if (!e) return false;
    return (
      e.name !== b.name ||
      e.aisle !== b.aisle ||
      e.bay !== b.bay ||
      e.level !== b.level ||
      e.parentId !== warehouseId
    );
  });

  try {
    // A single INSERT for the new rows rather than one round trip each.
    if (toCreate.length) {
      await prisma.location.createMany({
        data: toCreate.map((b) => ({ ...b, type: "BIN" as const, parentId: warehouseId })),
        skipDuplicates: true,
      });
    }
    const CHUNK = 100;
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      await prisma.$transaction(
        toUpdate.slice(i, i + CHUNK).map((b) =>
          prisma.location.update({
            where: { code: b.code },
            data: { ...b, type: "BIN", parentId: warehouseId },
          })
        )
      );
    }
  } catch (e) {
    return { ok: false, message: `Import failed: ${(e as Error).message}` };
  }

  const created = toCreate.length;
  const updated = toUpdate.length;
  const unchanged = bins.length - created - updated;

  if (unstructured.length) {
    errors.push(
      `${unstructured.length} code(s) are not Aisle-Bay or Aisle-Bay-Level, so they have no aisle to group or count by: ${unstructured
        .slice(0, 10)
        .join(", ")}${unstructured.length > 10 ? "…" : ""}`
    );
  }

  revalidatePath("/admin/locations");
  revalidatePath("/count");
  return {
    ok: true,
    message: `Done. ${created} added, ${updated} updated, ${unchanged} already current, ${skipped} skipped.`,
    created,
    updated,
    skipped,
    errors: errors.slice(0, 20),
  };
}
