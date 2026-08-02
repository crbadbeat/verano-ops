"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";
import { usdToCents, JOB_STAGES } from "@/lib/manufacturing";

// Manufacturing setup, re-homed from /manufacturing/setup to /admin/manufacturing.
// Logic is unchanged; only the revalidate target moved.
const REVALIDATE = "/admin/manufacturing";

// ---- employees --------------------------------------------------------------

export async function createEmployee(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");
  const name = String(formData.get("name") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim() || null;
  if (!name) return;
  await prisma.employee.create({ data: { name, code } });
  revalidatePath(REVALIDATE);
}

export async function toggleEmployeeActive(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;
  await prisma.employee.update({ where: { id }, data: { active: !active } });
  revalidatePath(REVALIDATE);
}

// ---- base styles ------------------------------------------------------------

export async function createBaseStyle(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim() || code;
  if (!code) return;
  await prisma.baseStyle.upsert({
    where: { code },
    create: { code, name },
    update: { name },
  });
  revalidatePath(REVALIDATE);
}

export async function toggleBaseStyleActive(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;
  await prisma.baseStyle.update({ where: { id }, data: { active: !active } });
  revalidatePath(REVALIDATE);
}

// ---- mod reasons ------------------------------------------------------------

export async function createModReason(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;
  await prisma.modReason.create({ data: { label } });
  revalidatePath(REVALIDATE);
}

export async function toggleModReasonActive(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;
  await prisma.modReason.update({ where: { id }, data: { active: !active } });
  revalidatePath(REVALIDATE);
}

// ---- bonus matrix (one row of stage amounts per style) ----------------------

export async function setBonusRatesForStyle(formData: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "admin.manufacturing:view");
  const baseStyleId = String(formData.get("baseStyleId") ?? "");
  if (!baseStyleId) return;

  for (const stage of JOB_STAGES) {
    const raw = formData.get(`amount_${stage}`);
    if (raw == null || String(raw).trim() === "") continue;
    const amountCents = usdToCents(String(raw));
    await prisma.bonusRate.upsert({
      where: { baseStyleId_stage: { baseStyleId, stage } },
      create: { baseStyleId, stage, amountCents },
      update: { amountCents },
    });
  }
  revalidatePath(REVALIDATE);
}
