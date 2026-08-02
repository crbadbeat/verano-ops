import "server-only";
import { prisma } from "@/lib/db";
import { DEFAULT_OVERHEAD_BPS } from "@/lib/overhead";
import { DEFAULT_MIN_DEPOSIT_BPS } from "@/lib/deposit";

// App-wide settings (singleton row, id "current"). Add fields here as more
// settings are needed.

/** Current landed-cost overhead in basis points (falls back to the default). */
export async function getOverheadBps(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { id: "current" } });
  return s?.overheadBps ?? DEFAULT_OVERHEAD_BPS;
}

/** Minimum deposit (basis points of grand total) to release a synced order to
 *  scheduling (falls back to the default). */
export async function getMinDepositBps(): Promise<number> {
  const s = await prisma.setting.findUnique({ where: { id: "current" } });
  return s?.minDepositBps ?? DEFAULT_MIN_DEPOSIT_BPS;
}
