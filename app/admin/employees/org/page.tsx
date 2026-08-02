import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import type { SalesLevel } from "@prisma/client";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { employeeName, SALES_LEVEL_LABEL } from "@/lib/employees";
import PageHeader from "@/components/ui/PageHeader";
import ResolveManagersButton from "@/components/admin/ResolveManagersButton";

export const dynamic = "force-dynamic";

type Node = {
  id: string;
  name: string;
  title: string | null;
  salesLevel: SalesLevel | null;
  active: boolean;
  children: Node[];
};

function OrgNode({ node, depth }: { node: Node; depth: number }) {
  return (
    <li>
      <div className="flex items-center gap-2 py-1 flex-wrap">
        <Link
          href={`/admin/employees/${node.id}`}
          className={`text-sm hover:text-ember hover:underline ${node.active ? "" : "text-muted line-through"}`}
        >
          {node.name}
        </Link>
        {node.salesLevel && <span className="badge text-teal text-xs">{SALES_LEVEL_LABEL[node.salesLevel]}</span>}
        {node.title && <span className="text-xs text-muted">{node.title}</span>}
        {node.children.length > 0 && (
          <span className="text-xs text-muted">({node.children.length})</span>
        )}
      </div>
      {node.children.length > 0 && depth < 12 && (
        <ul className="ml-5 border-l border-border/60 pl-3">
          {node.children.map((c) => (
            <OrgNode key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function OrgChartPage() {
  const me = await getViewer();
  if (!can(me, "admin.employees:view")) notFound();

  // Aliases are folded into their primary — show one node per person. Inactive
  // employees are excluded; an active report whose manager is inactive floats up
  // to a root rather than disappearing.
  const employees = await prisma.employee.findMany({
    where: { primaryId: null, active: true },
    orderBy: [{ name: "asc" }],
    select: { id: true, name: true, preferredName: true, title: true, salesLevel: true, active: true, managerId: true },
  });

  // Node.name is the DISPLAY name — the preferredName override if set (so a Jr./Sr.
  // pair reads distinctly), else the legal name.
  const byId = new Map(employees.map((e) => [e.id, { ...e, name: employeeName(e), children: [] as Node[] }]));
  const roots: Node[] = [];
  // Build the tree; a manager pointing outside the set (e.g. an alias) becomes a root.
  for (const e of byId.values()) {
    const parent = e.managerId ? byId.get(e.managerId) : null;
    if (parent && parent.id !== e.id) parent.children.push(e);
    else roots.push(e);
  }

  // Cycle safety: drop any node unreachable from a root would loop — mark visited.
  const seen = new Set<string>();
  const prune = (nodes: Node[]) => {
    for (const n of nodes) {
      if (seen.has(n.id)) {
        n.children = [];
        continue;
      }
      seen.add(n.id);
      prune(n.children);
    }
  };
  prune(roots);

  const withManager = employees.filter((e) => e.managerId).length;
  const total = employees.length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <Link href="/admin/employees" className="text-muted hover:text-foreground text-sm">
        ← Employees
      </Link>
      <PageHeader
        eyebrow="Admin"
        title="Org chart"
        description="Built from each employee's manager. Fill it from the ADP supervisor data in one click, then adjust by hand on each employee."
      />

      <div className="card p-4 space-y-3">
        <div className="text-sm text-muted">
          {withManager} of {total} people have a manager set.
        </div>
        <ResolveManagersButton />
      </div>

      <div className="card p-5">
        {roots.length === total ? (
          <p className="text-sm text-muted">
            No reporting lines yet — run “Resolve managers from ADP” above to build the chart.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {roots.map((r) => (
              <OrgNode key={r.id} node={r} depth={0} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
