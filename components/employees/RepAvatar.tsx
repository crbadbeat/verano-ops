"use client";

import { useEffect, useState } from "react";

// -----------------------------------------------------------------------------
// A rep's round photo, reusable across all reporting surfaces. Graceful cascade:
//   0 = stored photo → 1 = Verano flame (public/rep-flame.png) → 2 = initials.
// `version` (avatarUpdatedAt ms): a number busts the cache hard; null means "known
// to have no photo" (start at the flame); undefined means "unknown — try the photo
// and fall back on 404" (for pages that don't carry a version map).
// -----------------------------------------------------------------------------

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}

export default function RepAvatar({
  id,
  name,
  version,
  size = 28,
}: {
  id?: string | null;
  name: string;
  version?: number | null;
  size?: number;
}) {
  const start = (): 0 | 1 | 2 => (id == null || version === null ? 1 : 0);
  const [stage, setStage] = useState<0 | 1 | 2>(start);
  // Reset the cascade when the rep or their photo version changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- prop-driven reset, matches house pattern
  useEffect(() => setStage(start()), [id, version]);

  const style = { width: size, height: size } as const;
  const cls = "rounded-full object-cover shrink-0 bg-surface-2 border border-border";

  if (stage === 0 && id) {
    const src = version != null ? `/api/employees/${id}/avatar?v=${version}` : `/api/employees/${id}/avatar`;
    // eslint-disable-next-line @next/next/no-img-element -- byte-served route, not a static asset
    return <img src={src} alt={name} style={style} className={cls} onError={() => setStage(1)} />;
  }
  if (stage === 1) {
    // eslint-disable-next-line @next/next/no-img-element -- optional shared asset that may be absent
    return <img src="/rep-flame.png" alt={name} style={style} className={cls} onError={() => setStage(2)} />;
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-surface-2 border border-border font-semibold text-muted shrink-0"
      style={{ ...style, fontSize: Math.round(size * 0.36) }}
      role="img"
      aria-label={name}
    >
      {initials(name)}
    </span>
  );
}
