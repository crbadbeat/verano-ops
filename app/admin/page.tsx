import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";

import { can } from "@/lib/rbac";
import PageHeader from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

type Card = {
  href: string;
  title: string;
  description: string;
  show: boolean;
  danger?: boolean;
};

/**
 * Admin overview. The home for every setup surface that used to be scattered
 * across operational pages. Each card shows only if the person can use it, so a
 * warehouse manager sees data/locations/manufacturing, and an admin also sees
 * user management and the go-live reset.
 */
export default async function AdminHome() {
  const user = await getViewer();

  const cards: Card[] = [
    {
      href: "/admin/employees",
      title: "Employees",
      description:
        "The company directory: people, divisions & NetSuite ids, sales level, the org chart, separation and logins.",
      show: can(user, "admin.employees:view"),
    },
    {
      href: "/admin/regions",
      title: "Regions",
      description: "PGD territories — each Region is a Regional's set of showrooms; VPs oversee several.",
      show: can(user, "admin.employees:view"),
    },
    {
      href: "/admin/sales-centers",
      title: "Sales centers",
      description: "Map NetSuite sales centers to showrooms so sales roll up Division → Region → Showroom.",
      show: can(user, "admin.employees:view"),
    },
    {
      href: "/admin/users",
      title: "Users & roles",
      description:
        "Invite people, set their role and site scope, reset passwords, and deactivate accounts.",
      show: can(user, "admin.users:view"),
    },
    {
      href: "/admin/roles",
      title: "Roles & permissions",
      description:
        "Toggle what each position can see and do, assign people multiple roles, and set per-user exceptions.",
      show: can(user, "admin.roles:view"),
    },
    {
      href: "/admin/data",
      title: "Data imports",
      description:
        "Load the item master, on-hand, build classifications and barcodes.",
      show: can(user, "catalog:import"),
    },
    {
      href: "/admin/locations",
      title: "Locations & bins",
      description: "Warehouses, bins and staging lanes. Print QR labels for counts and picks.",
      show: can(user, "admin.locations:edit"),
    },
    {
      href: "/admin/manufacturing",
      title: "Manufacturing setup",
      description: "Workers, base styles, mod reasons and the bonus matrix.",
      show: can(user, "admin.manufacturing:view"),
    },
    {
      href: "/admin/price-lists",
      title: "Price lists",
      description: "The Price List options offered on the sales-entry form.",
      show: can(user, "admin.pricelists:edit"),
    },
    {
      href: "/admin/settings",
      title: "Settings",
      description: "Hub-wide configuration, like the landed-cost overhead % added to inventory value.",
      show: can(user, "catalog:edit"),
    },
    {
      href: "/admin/reset",
      title: "Reset hub data",
      description:
        "Wipe products and the transactional layer to reload the item master (go-live hard reset).",
      show: can(user, "admin.data:reset"),
      danger: true,
    },
  ];

  const shown = cards.filter((c) => c.show);
  if (shown.length === 0) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Admin"
        description="Setup and administration for the hub — everything that used to live on the operational pages."
      />

      <div className="grid sm:grid-cols-2 gap-4">
        {shown.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className={`card p-5 block transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ember ${
              c.danger ? "border-danger/40 hover:border-danger/70" : "hover:border-ember/60"
            }`}
          >
            <h2 className={`font-semibold ${c.danger ? "text-danger" : ""}`}>{c.title}</h2>
            <p className="text-sm text-muted mt-1">{c.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
