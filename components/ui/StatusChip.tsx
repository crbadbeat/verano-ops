import type { ReactNode } from "react";

export type Tone =
  | "muted"
  | "ember"
  | "teal"
  | "success"
  | "danger"
  | "showgood";

const TONE_CLASS: Record<Tone, string> = {
  muted: "text-muted",
  ember: "text-ember",
  teal: "text-teal",
  success: "text-success",
  danger: "text-danger",
  showgood: "text-showgood",
};

// One place for every status -> tone mapping, replacing the per-page maps that
// disagreed across orders / scheduling / staging. Covers the status enums used
// across the app; unknown values fall back to muted.
const STATUS_TONE: Record<string, Tone> = {
  // OrderStatus
  DRAFT: "muted",
  CONFIRMED: "success",
  CANCELLED: "danger",
  SCHEDULED: "ember",
  SHIPPED: "teal",
  DELIVERED: "teal",
  // TripStatus
  PLANNING: "muted",
  FINALIZED: "ember",
  STAGING: "ember",
  STAGED: "ember",
  QC_PASSED: "teal",
  LOADED: "teal",
  // TransferStatus
  IN_TRANSIT: "ember",
  RECEIVED: "teal",
  // ReturnStatus
  FLAGGED: "ember",
  CHECKED_IN: "teal",
  // GlassModStatus
  QUEUED: "ember",
  IN_PROGRESS: "ember",
  COMPLETED: "teal",
  // CountStatus
  OPEN: "ember",
  REVIEW: "ember",
  POSTED: "teal",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "muted";
}

/** A status pill with a consistent, app-wide colour for every known status. */
export default function StatusChip({
  status,
  label,
  tone,
  className = "",
}: {
  status?: string;
  label?: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const resolved = tone ?? statusTone(status ?? "");
  return (
    <span className={`badge ${TONE_CLASS[resolved]} ${className}`.trim()}>
      {label ?? status}
    </span>
  );
}
