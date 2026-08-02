"use server";

import { revalidatePath } from "next/cache";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { prisma } from "@/lib/db";

export interface SettingsState {
  ok?: boolean;
  message?: string;
}

/**
 * Set the landed-cost overhead percentage. Stored as basis points (11.8% ->
 * 1180). Applied to every warehouse's average cost for valuation except those
 * flagged overhead-exempt. MANAGER/ADMIN only.
 */
export async function updateOverhead(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.settings:edit");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const raw = String(formData.get("overheadPct") ?? "").trim();
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { ok: false, message: "Enter an overhead percentage between 0 and 100." };
  }
  const overheadBps = Math.round(pct * 100);

  await prisma.setting.upsert({
    where: { id: "current" },
    create: { id: "current", overheadBps },
    update: { overheadBps },
  });

  // Cost/value are derived at request time everywhere they're shown.
  revalidatePath("/admin/settings");
  revalidatePath("/inventory");
  revalidatePath("/inventory/dashboard");
  return { ok: true, message: `Landed-cost overhead set to ${(overheadBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%.` };
}

/**
 * Set the minimum deposit (% of grand total) a NetSuite-synced order must have
 * received before it is released to the scheduling team. Stored as basis points
 * (50% -> 5000). MANAGER/ADMIN only.
 */
export async function updateMinDeposit(
  _prev: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.settings:edit");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const raw = String(formData.get("minDepositPct") ?? "").trim();
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return { ok: false, message: "Enter a deposit percentage between 0 and 100." };
  }
  const minDepositBps = Math.round(pct * 100);

  await prisma.setting.upsert({
    where: { id: "current" },
    create: { id: "current", minDepositBps },
    update: { minDepositBps },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/scheduling");
  return {
    ok: true,
    message: `Minimum deposit to schedule set to ${(minDepositBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%.`,
  };
}
