import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import PageHeader from "@/components/ui/PageHeader";
import StatusChip from "@/components/ui/StatusChip";
import { createPromoter, updatePromoter } from "../actions";

export const dynamic = "force-dynamic";

export default async function PromotersPage() {
  const me = await getViewer();
  if (!can(me, "events:edit")) notFound();

  const promoters = await prisma.promoter.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { events: true } } },
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <Link href="/events" className="text-muted hover:text-foreground text-sm">
        ← Shows & events
      </Link>
      <PageHeader
        eyebrow="PGI"
        title="Promoters"
        description="Show organizers you work with — reusable contact records that many shows can point to."
      />

      <form action={createPromoter} className="card p-4 grid sm:grid-cols-2 gap-3">
        <label className="text-sm sm:col-span-2">
          <span className="text-muted">Promoter name *</span>
          <input name="name" required className="input mt-1" />
        </label>
        <label className="text-sm">
          <span className="text-muted">Contact</span>
          <input name="contactName" className="input mt-1" />
        </label>
        <label className="text-sm">
          <span className="text-muted">Phone</span>
          <input name="phone" className="input mt-1" />
        </label>
        <label className="text-sm">
          <span className="text-muted">Email</span>
          <input name="email" className="input mt-1" />
        </label>
        <label className="text-sm">
          <span className="text-muted">Website</span>
          <input name="website" className="input mt-1" placeholder="https://" />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="text-muted">Notes</span>
          <input name="notes" className="input mt-1" />
        </label>
        <div className="sm:col-span-2">
          <button className="btn btn-primary text-sm">Add promoter</button>
        </div>
      </form>

      <div className="space-y-3">
        {promoters.map((p) => (
          <div key={p.id} className="card p-4 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">{p.name}</span>
              {!p.active && <StatusChip label="Inactive" tone="danger" />}
              <span className="text-xs text-muted">
                {p._count.events} show{p._count.events === 1 ? "" : "s"}
              </span>
              {p.website && (
                <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-xs text-teal hover:underline ml-auto">
                  {p.website.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
            {(p.contactName || p.phone || p.email) && (
              <div className="text-sm text-muted flex flex-wrap gap-x-4">
                {p.contactName && <span>{p.contactName}</span>}
                {p.phone && <span>{p.phone}</span>}
                {p.email && <span>{p.email}</span>}
              </div>
            )}
            <details className="group">
              <summary className="cursor-pointer text-sm text-teal hover:underline">Edit</summary>
              <form action={updatePromoter} className="mt-3 grid sm:grid-cols-2 gap-3">
                <input type="hidden" name="promoterId" value={p.id} />
                <label className="text-sm sm:col-span-2">
                  <span className="text-muted">Name</span>
                  <input name="name" defaultValue={p.name} required className="input mt-1" />
                </label>
                <label className="text-sm">
                  <span className="text-muted">Contact</span>
                  <input name="contactName" defaultValue={p.contactName ?? ""} className="input mt-1" />
                </label>
                <label className="text-sm">
                  <span className="text-muted">Phone</span>
                  <input name="phone" defaultValue={p.phone ?? ""} className="input mt-1" />
                </label>
                <label className="text-sm">
                  <span className="text-muted">Email</span>
                  <input name="email" defaultValue={p.email ?? ""} className="input mt-1" />
                </label>
                <label className="text-sm">
                  <span className="text-muted">Website</span>
                  <input name="website" defaultValue={p.website ?? ""} className="input mt-1" />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="text-muted">Notes</span>
                  <input name="notes" defaultValue={p.notes ?? ""} className="input mt-1" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={p.active} />
                  <span>Active</span>
                </label>
                <div className="sm:col-span-2">
                  <button className="btn btn-ghost text-sm">Save</button>
                </div>
              </form>
            </details>
          </div>
        ))}
        {promoters.length === 0 && (
          <div className="card p-8 text-center text-muted text-sm">No promoters yet.</div>
        )}
      </div>
    </div>
  );
}
