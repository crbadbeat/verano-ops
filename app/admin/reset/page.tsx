import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import ResetForm from "@/components/admin/ResetForm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function ResetPage() {
  const user = await getViewer();
  if (!can(user, "admin.data:reset")) notFound();

  const [products, ledger, orders, trips, counts, transfers, returns, glassMods, mfg, aliases] =
    await Promise.all([
      prisma.product.count(),
      prisma.inventoryLedger.count(),
      prisma.order.count(),
      prisma.deliveryTrip.count(),
      prisma.countSession.count(),
      prisma.transfer.count(),
      prisma.returnOrder.count(),
      prisma.glassMod.count(),
      prisma.manufacturingEntry.count(),
      prisma.pickAlias.count(),
    ]);

  const rows: [string, number][] = [
    ["Products", products],
    ["Inventory ledger rows", ledger],
    ["Orders", orders],
    ["Delivery trips", trips],
    ["Count sessions", counts],
    ["Transfers", transfers],
    ["Returns", returns],
    ["Glass mods", glassMods],
    ["Manufacturing entries", mfg],
    ["Pick aliases", aliases],
  ];
  const total = rows.reduce((n, [, c]) => n + c, 0);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-muted hover:underline">
          ← Admin
        </Link>
        <h1 className="text-3xl font-bold tracking-tight mt-2">Reset hub data</h1>
        <p className="text-muted mt-1">
          Empties products and the transactional layer so the Item Master can be reloaded
          fresh (and for the go-live hard reset). This cannot be undone.
        </p>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold mb-3">What this deletes</h2>
        <ul className="divide-y divide-border/60 text-sm">
          {rows.map(([label, count]) => (
            <li key={label} className="flex items-center justify-between py-2">
              <span className={count > 0 ? "" : "text-muted"}>{label}</span>
              <span className="tabular-nums font-semibold">{count.toLocaleString()}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted mt-3">
          <span className="text-foreground">Kept:</span> users, all locations (warehouses, bins,
          staging lanes), config, and manufacturing setup (employees, styles, bonus rates, mod
          reasons).
        </p>
      </div>

      <div className="card p-5 space-y-3 border-danger/40">
        <h2 className="font-semibold text-danger">Danger zone</h2>
        <p className="text-sm text-muted">
          Deletes {total.toLocaleString()} row(s) across the tables above, in a single transaction.
          Everything else stays. Type <span className="font-mono text-foreground">RESET</span> to
          confirm.
        </p>
        <ResetForm />
      </div>
    </div>
  );
}
