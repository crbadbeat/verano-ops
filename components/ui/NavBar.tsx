"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { VisibleGroup } from "@/lib/nav";
import { logout } from "@/app/login/actions";

/**
 * The application shell's top bar: a role-filtered, grouped navigation with
 * dropdowns on desktop and a drawer on tablet/mobile. It receives already-
 * filtered groups from the server `Nav`, so it never renders a link the user
 * can't use. Touch targets are >=44px and menus close on navigation.
 */
export default function NavBar({
  groups,
  user,
}: {
  groups: VisibleGroup[];
  user: { email: string; roleLabel: string } | null;
}) {
  const pathname = usePathname();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [logoOk, setLogoOk] = useState(true);
  const barRef = useRef<HTMLDivElement | null>(null);

  // Close menus on an outside click or Escape. (setState here runs inside event
  // listeners, not the effect body, so it is not a set-state-in-effect.)
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (barRef.current && !barRef.current.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenGroup(null);
        setDrawerOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  function closeAll() {
    setOpenGroup(null);
    setDrawerOpen(false);
  }

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }
  function groupActive(group: VisibleGroup) {
    return group.items.some((item) => isActive(item.href));
  }

  return (
    <header className="border-b border-border/70 bg-surface/60 backdrop-blur sticky top-0 z-30">
      <div ref={barRef} className="mx-auto max-w-6xl px-4 h-14 flex items-center gap-3">
        <Link
          href="/"
          onClick={closeAll}
          className="flex items-center gap-2 font-bold tracking-tight shrink-0"
        >
          {logoOk ? (
            <img
              src="/logo.png"
              alt="Verano Outdoor Living"
              className="h-8 w-auto"
              onError={() => setLogoOk(false)}
            />
          ) : (
            <span className="text-foreground">Verano Outdoor Living</span>
          )}
        </Link>

        {user && (
          <>
            <nav className="hidden md:flex items-center gap-0.5 text-sm" aria-label="Primary">
              {groups.map((group) =>
                group.items.length === 1 ? (
                  <Link
                    key={group.id}
                    href={group.items[0].href}
                    onClick={closeAll}
                    className={`px-3 py-1.5 rounded-lg hover:bg-surface-2 ${
                      isActive(group.items[0].href) ? "text-ember" : ""
                    }`}
                  >
                    {group.items[0].label}
                  </Link>
                ) : (
                  <div key={group.id} className="relative">
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={openGroup === group.id}
                      onClick={() =>
                        setOpenGroup((current) => (current === group.id ? null : group.id))
                      }
                      className={`px-3 py-1.5 rounded-lg hover:bg-surface-2 inline-flex items-center gap-1 ${
                        groupActive(group) ? "text-ember" : ""
                      }`}
                    >
                      {group.label}
                      <span aria-hidden className="text-[0.6rem] opacity-70">
                        ▼
                      </span>
                    </button>
                    {openGroup === group.id && (
                      <div
                        role="menu"
                        className="absolute left-0 top-full mt-1 min-w-52 card p-1 shadow-2xl z-40"
                      >
                        {group.items.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            role="menuitem"
                            title={item.hint}
                            onClick={closeAll}
                            className={`block px-3 py-2 rounded-lg hover:bg-surface-2 ${
                              isActive(item.href) ? "text-ember" : ""
                            }`}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}
            </nav>

            <div className="ml-auto hidden md:flex items-center gap-3 text-sm">
              <div className="text-right leading-tight">
                <div className="text-muted text-xs">{user.roleLabel}</div>
                <div className="text-xs">{user.email}</div>
              </div>
              <form action={logout}>
                <button className="btn btn-ghost py-1.5 px-3 text-sm" type="submit">
                  Sign out
                </button>
              </form>
            </div>

            <div className="ml-auto md:hidden">
              <button
                type="button"
                aria-label={drawerOpen ? "Close menu" : "Open menu"}
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((open) => !open)}
                className="btn btn-ghost py-2 px-3"
              >
                <span aria-hidden>{drawerOpen ? "✕" : "☰"}</span>
              </button>
            </div>
          </>
        )}
      </div>

      {user && drawerOpen && (
        <div className="md:hidden border-t border-border bg-surface/95 backdrop-blur">
          <nav className="mx-auto max-w-6xl px-4 py-3 space-y-4" aria-label="Mobile">
            {groups.map((group) => (
              <div key={group.id}>
                <p className="text-xs font-mono uppercase tracking-widest text-muted mb-1">
                  {group.label}
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={closeAll}
                      className={`px-3 py-2 rounded-lg hover:bg-surface-2 ${
                        isActive(item.href) ? "text-ember" : ""
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-border flex items-center justify-between gap-3">
              <div className="text-xs">
                <div className="text-muted">{user.roleLabel}</div>
                <div>{user.email}</div>
              </div>
              <form action={logout}>
                <button className="btn btn-ghost py-1.5 px-3 text-sm" type="submit">
                  Sign out
                </button>
              </form>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
