import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { stockByWarehouse, stockAt, splitTotal, costsForWarehouse } from "@/lib/inventory";
import { getOverheadBps } from "@/lib/settings";
import { burdenedCost } from "@/lib/overhead";

export const dynamic = "force-dynamic";

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
const dollars = (cents: number | null): string => (cents == null ? "" : (cents / 100).toFixed(2));

/**
 * Download the inventory for the selected warehouse as CSV — one row per item,
 * with on-hand split, the warehouse's NetSuite average cost (falling back to the
 * account-wide average), and the extended value. Honors the same ?wh / ?filter /
 * ?q the Stock page uses, so the file matches what's on screen.
 */
export async function GET(req: NextRequest) {
  const user = await getViewer();
  if (!can(user, "inventory:view")) return new Response("Forbidden", { status: 403 });

  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const filter = sp.get("filter") === "below" ? "below" : sp.get("filter") === "all" ? "all" : "instock";

  const warehouses = await prisma.location.findMany({
    where: { type: "WAREHOUSE" },
    orderBy: [{ isDefaultWarehouse: "desc" }, { name: "asc" }],
    select: { id: true, code: true, name: true, isDefaultWarehouse: true, overheadExempt: true },
  });
  if (warehouses.length === 0) return new Response("No warehouses", { status: 404 });
  const selected =
    warehouses.find((w) => w.id === sp.get("wh")) ??
    warehouses.find((w) => w.isDefaultWarehouse) ??
    warehouses[0];

  const [products, byWarehouse, whCosts, overheadBps] = await Promise.all([
    prisma.product.findMany({
      where: { active: true },
      select: {
        id: true, sku: true, name: true, description: true, category: true,
        maxStockLevel: true, standardCostCents: true,
      },
    }),
    stockByWarehouse(),
    costsForWarehouse(selected.id),
    getOverheadBps(),
  ]);

  type Row = {
    sku: string; name: string; category: string | null; description: string | null;
    neu: number; showGood: number; total: number; max: number | null; belowMax: boolean;
    unitCostCents: number | null; costSource: string; valueCents: number | null;
  };
  let rows: Row[] = products.map((p) => {
    const split = stockAt(byWarehouse, selected.id, p.id);
    const total = splitTotal(split);
    const whCost = whCosts.get(p.id) ?? null;
    const base = whCost ?? p.standardCostCents ?? null;
    const unitCostCents = base != null ? burdenedCost(base, overheadBps, selected.overheadExempt) : null;
    return {
      sku: p.sku, name: p.name, category: p.category, description: p.description,
      neu: split.new, showGood: split.showGood, total,
      max: p.maxStockLevel,
      belowMax: p.maxStockLevel != null && total < p.maxStockLevel,
      unitCostCents,
      costSource: whCost != null ? "warehouse" : p.standardCostCents != null ? "account" : "none",
      valueCents: unitCostCents != null ? total * unitCostCents : null,
    };
  });

  if (q) {
    rows = rows.filter(
      (r) =>
        r.sku.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
    );
  }
  rows =
    filter === "instock" ? rows.filter((r) => r.total > 0)
    : filter === "below" ? rows.filter((r) => r.belowMax)
    : rows;
  rows.sort((a, b) => a.sku.localeCompare(b.sku));

  const header = [
    "SKU", "Item", "Category", "New", "Show Good", "On Hand", "Max", "Below Max",
    "Avg Cost", "Cost Source", "Extended Value",
  ].join(",");
  const lines = rows.map((r) =>
    [
      csvCell(r.sku), csvCell(r.name), csvCell(r.category ?? ""),
      String(r.neu), String(r.showGood), String(r.total),
      r.max == null ? "" : String(r.max), r.belowMax ? "yes" : "",
      dollars(r.unitCostCents), r.costSource, dollars(r.valueCents),
    ].join(",")
  );
  // Totals row for a quick sanity check against NetSuite.
  const totalValue = rows.reduce((s, r) => s + (r.valueCents ?? 0), 0);
  const totalUnits = rows.reduce((s, r) => s + r.total, 0);
  const totalsLine = ["TOTAL", "", "", "", "", String(totalUnits), "", "", "", "", dollars(totalValue)].join(",");

  const body = [header, ...lines, totalsLine].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  const fname = `inventory-${selected.code}-${date}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
