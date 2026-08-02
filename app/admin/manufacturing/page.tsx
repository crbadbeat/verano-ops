import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import PageHeader from "@/components/ui/PageHeader";
import { JOB_STAGES, STAGE_LABEL, centsToUsd } from "@/lib/manufacturing";
import {
  createEmployee,
  toggleEmployeeActive,
  createBaseStyle,
  toggleBaseStyleActive,
  createModReason,
  toggleModReasonActive,
  setBonusRatesForStyle,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminManufacturingSetupPage() {
  const user = await getViewer();
  // Setup edits are MANAGER-only (matching the moved server actions).
  if (!can(user, "admin.manufacturing:view")) notFound();

  const [employees, styles, reasons] = await Promise.all([
    prisma.employee.findMany({ orderBy: { name: "asc" } }),
    prisma.baseStyle.findMany({
      orderBy: { code: "asc" },
      include: { bonusRates: true },
    }),
    prisma.modReason.findMany({ orderBy: { label: "asc" } }),
  ]);

  const rateByStyle = new Map<string, Record<string, number>>();
  for (const s of styles) {
    const m: Record<string, number> = {};
    for (const r of s.bonusRates) m[r.stage] = r.amountCents;
    rateByStyle.set(s.id, m);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Manufacturing setup"
        description="Workers, base styles, mod reasons, and the bonus matrix."
        actions={
          <>
            <Link href="/manufacturing/bom" className="btn btn-ghost">
              Edit BOM
            </Link>
            <Link href="/manufacturing" className="btn btn-ghost">
              Build floor
            </Link>
          </>
        }
      />

      {/* Employees */}
      <section className="card p-5 space-y-4">
        <h2 className="font-semibold">Employees</h2>
        <form action={createEmployee} className="flex flex-col sm:flex-row gap-2">
          <input name="name" placeholder="Worker name" required className="input" />
          <input name="code" placeholder="Code (optional)" className="input sm:max-w-[160px]" />
          <button className="btn btn-primary whitespace-nowrap" type="submit">
            Add worker
          </button>
        </form>
        {employees.length > 0 && (
          <ul className="divide-y divide-border/50">
            {employees.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-2 text-sm">
                <span>{e.name}</span>
                {e.code && <span className="badge font-mono">{e.code}</span>}
                <form action={toggleEmployeeActive} className="ml-auto">
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="active" value={String(e.active)} />
                  <button
                    className={`badge ${e.active ? "text-success" : "text-danger"}`}
                    type="submit"
                  >
                    {e.active ? "Active" : "Inactive"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Base styles */}
      <section className="card p-5 space-y-4">
        <h2 className="font-semibold">Base styles</h2>
        <form action={createBaseStyle} className="flex flex-col sm:flex-row gap-2">
          <input name="code" placeholder="Code (e.g. GR)" required className="input sm:max-w-[160px]" />
          <input name="name" placeholder="Name (e.g. Grand)" className="input" />
          <button className="btn btn-primary whitespace-nowrap" type="submit">
            Add style
          </button>
        </form>
        {styles.length > 0 && (
          <ul className="divide-y divide-border/50">
            {styles.map((s) => (
              <li key={s.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="badge font-mono">{s.code}</span>
                <span>{s.name}</span>
                <form action={toggleBaseStyleActive} className="ml-auto">
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="active" value={String(s.active)} />
                  <button
                    className={`badge ${s.active ? "text-success" : "text-danger"}`}
                    type="submit"
                  >
                    {s.active ? "Active" : "Inactive"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Mod reasons */}
      <section className="card p-5 space-y-4">
        <h2 className="font-semibold">Mod reasons</h2>
        <form action={createModReason} className="flex flex-col sm:flex-row gap-2">
          <input name="label" placeholder="Reason (e.g. Added double burner)" required className="input" />
          <button className="btn btn-primary whitespace-nowrap" type="submit">
            Add reason
          </button>
        </form>
        {reasons.length > 0 && (
          <ul className="divide-y divide-border/50">
            {reasons.map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2 text-sm">
                <span>{r.label}</span>
                <form action={toggleModReasonActive} className="ml-auto">
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="active" value={String(r.active)} />
                  <button
                    className={`badge ${r.active ? "text-success" : "text-danger"}`}
                    type="submit"
                  >
                    {r.active ? "Active" : "Inactive"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Bonus matrix */}
      <section className="card p-5 space-y-3">
        <h2 className="font-semibold">Bonus matrix ($ per worker, per stage)</h2>
        {styles.length === 0 ? (
          <p className="text-sm text-muted">Add a base style first.</p>
        ) : (
          <div className="space-y-1">
            <div className="hidden md:flex gap-2 text-xs text-muted px-1">
              <div className="w-24">Style</div>
              {JOB_STAGES.map((s) => (
                <div key={s} className="w-20">
                  {STAGE_LABEL[s]}
                </div>
              ))}
            </div>
            {styles.map((s) => {
              const rates = rateByStyle.get(s.id) ?? {};
              return (
                <form
                  key={s.id}
                  action={setBonusRatesForStyle}
                  className="flex flex-wrap items-end gap-2 border-b border-border/40 py-2"
                >
                  <input type="hidden" name="baseStyleId" value={s.id} />
                  <div className="w-24 font-medium text-sm">{s.code}</div>
                  {JOB_STAGES.map((stage) => (
                    <label key={stage} className="text-[11px] text-muted md:text-transparent">
                      <span className="md:hidden">{STAGE_LABEL[stage]}</span>
                      <input
                        name={`amount_${stage}`}
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={
                          rates[stage] != null ? centsToUsd(rates[stage]) : ""
                        }
                        placeholder="0.00"
                        className="input w-20 mt-0.5 py-1"
                      />
                    </label>
                  ))}
                  <button className="btn btn-ghost py-1 px-2 text-xs" type="submit">
                    Save
                  </button>
                </form>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
