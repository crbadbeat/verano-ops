import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { employeeName, SALES_LEVEL_LABEL } from "@/lib/employees";
import PageHeader from "@/components/ui/PageHeader";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SearchBox from "@/components/ui/SearchBox";
import Pagination from "@/components/ui/Pagination";
import StatusChip from "@/components/ui/StatusChip";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Row = {
  id: string;
  name: string;
  title: string | null;
  active: boolean;
  hasLogin: boolean;
  level: string | null;
  divisions: string[];
  home: string | null;
  manager: string | null;
  region: string | null;
  aliasOf: string | null;
  linkedCount: number;
  haystack: string;
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; div?: string; status?: string; page?: string }>;
}) {
  const me = await getViewer();
  if (!can(me, "admin.employees:view")) notFound();

  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const div = sp.div === "PGI" || sp.div === "PGD" ? sp.div : "all";
  const status = sp.status === "all" ? "all" : sp.status === "inactive" ? "inactive" : "active";

  const employees = await prisma.employee.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      title: true,
      email: true,
      code: true,
      adpId: true,
      active: true,
      salesLevel: true,
      userId: true,
      homeLocation: { select: { name: true, code: true } },
      manager: { select: { name: true } },
      region: { select: { name: true } },
      divisions: { select: { division: true } },
      primaryId: true,
      primary: { select: { name: true } },
      _count: { select: { aliases: true } },
    },
  });

  const allRows: Row[] = employees.map((e) => {
    const name = employeeName(e);
    const divisions = e.divisions.map((d) => d.division);
    return {
      id: e.id,
      name,
      title: e.title,
      active: e.active,
      hasLogin: !!e.userId,
      level: e.salesLevel ? SALES_LEVEL_LABEL[e.salesLevel] : null,
      divisions,
      home: e.homeLocation ? `${e.homeLocation.name}` : null,
      manager: e.manager?.name ?? null,
      region: e.region?.name ?? null,
      aliasOf: e.primaryId ? e.primary?.name ?? "another record" : null,
      linkedCount: e._count.aliases,
      haystack: [name, e.name, e.title, e.email, e.code, e.adpId, e.homeLocation?.name, e.region?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });

  const activeCount = allRows.filter((r) => r.active).length;

  const filtered = allRows.filter((r) => {
    if (status === "active" && !r.active) return false;
    if (status === "inactive" && r.active) return false;
    if (div !== "all" && !r.divisions.includes(div)) return false;
    if (q && !r.haystack.includes(q)) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), totalPages);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Build filter links that preserve the search term.
  const withParams = (overrides: Record<string, string>) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (div !== "all") p.set("div", div);
    if (status !== "active") p.set("status", status);
    for (const [k, v] of Object.entries(overrides)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const s = p.toString();
    return s ? `/admin/employees?${s}` : "/admin/employees";
  };

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Employee",
      cell: (r) => (
        <div className="min-w-0">
          <Link href={`/admin/employees/${r.id}`} className="font-medium hover:text-ember hover:underline">
            {r.name}
          </Link>
          {r.aliasOf && <span className="badge text-muted ml-2 text-xs">alias of {r.aliasOf}</span>}
          {r.linkedCount > 0 && (
            <span className="badge text-teal ml-2 text-xs">linked ×{r.linkedCount}</span>
          )}
          {r.title && <div className="text-xs text-muted truncate">{r.title}</div>}
        </div>
      ),
    },
    {
      key: "division",
      header: "Division",
      cell: (r) =>
        r.divisions.length ? (
          <div className="flex gap-1 flex-wrap">
            {r.divisions.map((d) => (
              <span key={d} className="badge text-teal">
                {d}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "level",
      header: "Sales level",
      cell: (r) => r.level ?? <span className="text-muted">—</span>,
    },
    { key: "home", header: "Home site", cell: (r) => r.home ?? <span className="text-muted">—</span> },
    { key: "region", header: "Region", cell: (r) => r.region ?? <span className="text-muted">—</span> },
    { key: "manager", header: "Reports to", cell: (r) => r.manager ?? <span className="text-muted">—</span> },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          {r.active ? (
            <StatusChip label="Active" tone="success" />
          ) : (
            <StatusChip label="Inactive" tone="danger" />
          )}
          {r.hasLogin && <span className="badge text-muted" title="Has a login">login</span>}
        </div>
      ),
    },
  ];

  const filterLink = (label: string, href: string, on: boolean) => (
    <Link
      href={href}
      className={`badge ${on ? "text-ember border-ember/40" : "text-muted hover:text-foreground"}`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Employees"
        description="The company directory — every person, their division, sales level, org position and login. Org changes are effective-dated on each employee's page."
        actions={
          <>
            <Link href="/admin/employees/org" className="btn btn-ghost text-sm">
              Org chart
            </Link>
            <Link href="/admin/employees/import" className="btn btn-ghost text-sm">
              Import from ADP
            </Link>
            <Link href="/admin/employees/new" className="btn btn-primary text-sm">
              Add employee
            </Link>
          </>
        }
      />

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold">Directory</h2>
          <span className="badge">{filtered.length}</span>
          <span className="text-xs text-muted">{activeCount} active</span>

          <div className="flex items-center gap-1.5 ml-2">
            {filterLink("All divisions", withParams({ div: "" }), div === "all")}
            {filterLink("PGI", withParams({ div: "PGI" }), div === "PGI")}
            {filterLink("PGD", withParams({ div: "PGD" }), div === "PGD")}
          </div>
          <div className="flex items-center gap-1.5">
            {filterLink("Active", withParams({ status: "" }), status === "active")}
            {filterLink("Inactive", withParams({ status: "inactive" }), status === "inactive")}
            {filterLink("All", withParams({ status: "all" }), status === "all")}
          </div>

          <div className="ml-auto">
            <SearchBox placeholder="Search name, title, email, ID…" />
          </div>
        </div>

        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          emptyMessage={q ? `No employees match “${q}”.` : "No employees yet. Add one to get started."}
        />
        <Pagination page={page} totalPages={totalPages} />
      </div>
    </div>
  );
}
