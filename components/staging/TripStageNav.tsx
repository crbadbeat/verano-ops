import Link from "next/link";

// The ops-flow navigator shown on every per-trip workspace: Pick → Confirm →
// QC → Dispatch. Each step links to its own focused screen (the old fused
// /staging screen is now these four). Purely UX — each destination page keeps
// its own capability guard, so a step a given role can't work still shows the
// pipeline but bounces on entry.

type Step = "pick" | "confirm" | "qc" | "dispatch";

const STEPS: { key: Step; label: string; href: (id: string) => string }[] = [
  { key: "pick", label: "Pick", href: (id) => `/staging/${id}` },
  { key: "confirm", label: "Confirm", href: (id) => `/staging/${id}/confirm` },
  { key: "qc", label: "QC", href: (id) => `/qc/${id}` },
  { key: "dispatch", label: "Dispatch", href: (id) => `/dispatch/${id}` },
];

export default function TripStageNav({ tripId, active }: { tripId: string; active: Step }) {
  return (
    <nav className="flex items-center gap-1 flex-wrap text-sm" aria-label="Trip stages">
      {STEPS.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1">
          <Link
            href={s.href(tripId)}
            aria-current={active === s.key ? "page" : undefined}
            className={`px-3 py-1.5 rounded-lg font-medium ${
              active === s.key
                ? "bg-surface-2 text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
          {i < STEPS.length - 1 && <span className="text-muted/50" aria-hidden>→</span>}
        </span>
      ))}
    </nav>
  );
}
