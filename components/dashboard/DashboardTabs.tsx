"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Cockpit switcher. The set of tabs is filtered by role on the server; each tab
 * carries the current range + site query so switching cockpits keeps the window.
 */
export default function DashboardTabs({
  tabs,
}: {
  tabs: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={qs ? `${tab.href}?${qs}` : tab.href}
            className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${
              active
                ? "border-ember text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
