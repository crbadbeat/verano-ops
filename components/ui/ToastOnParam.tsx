"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useToast } from "./Toast";

/**
 * Fires a toast when the page loads with a matching success query param (set by
 * a server action's redirect, e.g. `redirect("/admin/price-lists?saved=1")`),
 * then strips the param so a refresh doesn't re-toast. `map` is param → message.
 */
export default function ToastOnParam({ map }: { map: Record<string, string> }) {
  const sp = useSearchParams();
  const toast = useToast();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    for (const key of Object.keys(map)) {
      if (sp.get(key) != null) {
        fired.current = true;
        toast(map[key]);
        const params = new URLSearchParams(window.location.search);
        params.delete(key);
        const qs = params.toString();
        window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
        break;
      }
    }
  }, [sp, map, toast]);

  return null;
}
