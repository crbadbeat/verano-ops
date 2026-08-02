"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRef, useState, type ChangeEvent } from "react";

/**
 * A debounced search input that drives a `?<param>=` query string. Pages read
 * the param from `searchParams` and filter server-side, so results survive a
 * refresh and a shared link. Resets pagination on a new query.
 */
export default function SearchBox({
  placeholder = "Search…",
  param = "q",
  className = "max-w-xs",
}: {
  placeholder?: string;
  param?: string;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get(param) ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function push(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set(param, next);
    else params.delete(param);
    params.delete("page"); // a new search starts on page 1
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(next), 300);
  }

  return (
    <input
      type="search"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={placeholder}
      className={`input ${className}`.trim()}
    />
  );
}
