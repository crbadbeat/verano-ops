"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/events", label: "Calendar", match: (p: string) => p === "/events" },
  { href: "/events/active", label: "Active shows", match: (p: string) => p.startsWith("/events/active") },
  { href: "/events/analytics", label: "Analytics", match: (p: string) => p.startsWith("/events/analytics") },
  { href: "/events/reconciliation", label: "Reconciliation", match: (p: string) => p.startsWith("/events/reconciliation") },
  { href: "/events/tv", label: "TV Dashboard", match: (p: string) => p.startsWith("/events/tv") },
];

/** Top-level view switcher for the Shows & Events area. */
export default function EventsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${
              active ? "border-ember text-foreground font-medium" : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
