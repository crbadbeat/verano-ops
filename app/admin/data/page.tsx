import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import Link from "next/link";

import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { netsuiteConfig } from "@/lib/netsuite";
import Uploader from "@/components/Uploader";
import PageHeader from "@/components/ui/PageHeader";
import StatusChip from "@/components/ui/StatusChip";
import {
  uploadItemMaster,
  uploadSeed,
  uploadClassifications,
  uploadBarcodes,
  uploadInventoryByLocation,
} from "./actions";

export const dynamic = "force-dynamic";
// The by-location replace can write many ledger rows; give its action headroom.
export const maxDuration = 60;

/**
 * Admin › Data imports. Every bulk spreadsheet uploader lives here, off the
 * operational Stock page. The server actions were moved verbatim from
 * /inventory; the role gates are unchanged (MANAGER — ADMIN passes as superuser).
 */
export default async function AdminDataPage() {
  const user = await getViewer();
  if (!can(user, "catalog:import")) notFound();

  const nsConfigured = netsuiteConfig() !== null;
  const withCost = await prisma.product.count({
    where: { standardCostCents: { not: null } },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Data imports"
        description="Load the item master, on-hand, mappings, classifications and barcodes from spreadsheets. These used to sit on the Stock page."
        actions={
          <Link href="/inventory" className="btn btn-ghost text-sm">
            View Stock
          </Link>
        }
      />

      <div className="card p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold">NetSuite cost sync</h2>
          <StatusChip
            label={nsConfigured ? "Configured" : "Not configured"}
            tone={nsConfigured ? "success" : "muted"}
          />
          <span className="badge">{withCost.toLocaleString()} with cost</span>
        </div>
        <p className="text-sm text-muted mt-2">
          Standard cost and item descriptions refresh automatically every night from
          NetSuite over SuiteQL, keyed on the NetSuite number.{" "}
          {nsConfigured
            ? "Credentials are set."
            : "Set the NETSUITE_* and CRON_SECRET environment variables to enable it."}{" "}
          New items still come from the item-master import below.
        </p>
      </div>

      <Uploader
        action={uploadItemMaster}
        title="Import Item Master (NetSuite)"
        hint="Build or refresh the master from your NetSuite item export, keyed on the stable NetSuite Number (the NetSuite name becomes a display-only description). Columns: NetSuite Number, Description, Display Name, Barcode, Category, SKU. For every Base/Glass row put its smart-SKU in the SKU column (required); appliances/accessories leave SKU blank (defaults to the number). Include the NetSuite Number whenever you have it. Updates/links existing items by number or SKU — safe to re-run."
        cta="Import item master"
      />

      <div className="grid md:grid-cols-2 gap-4">
        <Uploader
          action={uploadSeed}
          title="Seed / update on-hand"
          hint="Upload a .csv or .xlsx with SKU (NetSuite name) and Qty columns. Optional: Name, Category."
          cta="Upload counts"
        />
        <Uploader
          action={uploadClassifications}
          title="Import build classifications"
          hint="Upload the Base or Glass lookup sheet to attach Parent/Child/Special and the SKU each item is built or cut from. Existing products only — rows with no product are reported, never created."
          cta="Import classifications"
        />
        <Uploader
          action={uploadBarcodes}
          title="Import item barcodes"
          hint="Upload a .csv or .xlsx with SKU and Barcode columns so scan-picking resolves the item. Bases/Glass scan a QR of the SKU itself; this is for the other items. Existing products only."
          cta="Import barcodes"
        />
      </div>

      <Uploader
        action={uploadInventoryByLocation}
        title="Replace ALL inventory by location"
        hint="Full re-baseline from a physical count: on-hand is set to exactly what's in the file, and every slot NOT listed is zeroed. Columns: SKU, Location (bin code; blank = warehouse level), Quantity, Condition (NEW/SHOW_GOOD). Unknown SKUs are auto-created; unknown locations are reported. Kept as auditable ledger adjustments."
        cta="Replace all inventory"
      />
    </div>
  );
}
