import { redirect } from "next/navigation";
import { requireDashboardUser } from "@/lib/reporting/scope";

export const dynamic = "force-dynamic";

/**
 * Dashboards entry point. Gates access, then routes to the right cockpit,
 * preserving the range/site query. For now every leader lands on the Warehouse
 * board; this becomes a role-aware router (Executive, Department, …) as those
 * cockpits ship.
 */
export default async function DashboardIndex({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireDashboardUser();
  const sp = await searchParams;
  const entries = Object.entries(sp).filter(
    (entry): entry is [string, string] => entry[1] != null
  );
  const qs = new URLSearchParams(entries).toString();
  const home = user.role === "EXECUTIVE" ? "/dashboard/exec" : "/dashboard/warehouse";
  redirect(qs ? `${home}?${qs}` : home);
}
