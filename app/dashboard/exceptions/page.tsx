import Link from "next/link";
import { requireDashboardUser, resolveSiteScope, dashboardTabs } from "@/lib/reporting/scope";
import { getExceptions, type ExceptionGroup } from "@/lib/reporting/exceptions";
import DashboardChrome from "@/components/dashboard/DashboardChrome";

export const dynamic = "force-dynamic";

const COUNT_TONE: Record<ExceptionGroup["tone"], string> = {
  danger: "text-danger",
  ember: "text-ember",
  muted: "text-muted",
};

export default async function ExceptionsDashboard({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const user = await requireDashboardUser();
  const sp = await searchParams;
  const scope = await resolveSiteScope(sp.site);
  const groups = await getExceptions(scope, new Date());
  const total = groups.reduce((sum, group) => sum + group.count, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <DashboardChrome
        title="Exceptions"
        description="Everything at risk of missing a truck or corrupting the numbers, in one place."
        scope={scope}
        tabs={dashboardTabs(user)}
      />

      {total === 0 ? (
        <div className="card p-10 text-center">
          <p className="font-semibold">Nothing flagged</p>
          <p className="text-muted mt-1">No blockers or data-integrity issues right now.</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {groups.map((group) => (
            <section key={group.key} className="card overflow-hidden flex flex-col">
              <div className="p-4 border-b border-border flex items-center gap-3">
                <h2 className="font-semibold">{group.title}</h2>
                <span className={`badge ${group.count > 0 ? COUNT_TONE[group.tone] : "text-muted"}`}>
                  {group.count}
                </span>
              </div>

              {group.items.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted flex-1">Clear.</div>
              ) : (
                <ul className="divide-y divide-border/60 flex-1">
                  {group.items.map((item) => (
                    <li key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                      {item.href ? (
                        <Link
                          href={item.href}
                          className="font-medium hover:text-ember hover:underline truncate"
                        >
                          {item.label}
                        </Link>
                      ) : (
                        <span className="font-medium truncate">{item.label}</span>
                      )}
                      {item.detail && (
                        <span className="ml-auto text-xs text-muted tabular-nums shrink-0">
                          {item.detail}
                        </span>
                      )}
                    </li>
                  ))}
                  {group.count > group.items.length && (
                    <li className="px-4 py-2 text-xs text-muted">
                      + {group.count - group.items.length} more
                    </li>
                  )}
                </ul>
              )}

              <div className="p-3 border-t border-border text-xs text-muted">{group.blurb}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
