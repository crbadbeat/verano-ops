"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Periodically re-fetches the server component it sits on (router.refresh) so a
 * wall-mounted "active shows" board stays current without a manual reload. Pauses
 * while the tab is hidden. Renders a tiny "updated Xs ago" note.
 */
export default function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      router.refresh();
      setTick((t) => t + 1);
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);

  return (
    <span className="text-xs text-muted" title={`Refreshes every ${seconds}s`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-success align-middle mr-1.5 animate-pulse" />
      Live · auto-refresh {seconds}s{tick > 0 ? ` · ${tick} update${tick === 1 ? "" : "s"}` : ""}
    </span>
  );
}
