// Pure glass-mod scheduling helpers (no DB) — unit-tested in lib/glass.test.ts.
// All arithmetic is UTC so it lines up with Prisma `@db.Date` values (stored
// without a time zone) and never drifts a day across the local offset.

export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6; // Sunday | Saturday
}

/** Step back `n` business days (Mon–Fri), skipping weekends. */
export function subtractBusinessDays(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  let remaining = Math.max(0, Math.floor(n));
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

/**
 * When a waterjet job is due: by default 2 business days before the order's
 * scheduled load date, so cut glass is ready well before the truck loads.
 */
export function dueDateForLoadDate(loadDate: Date, leadBusinessDays = 2): Date {
  return subtractBusinessDays(loadDate, leadBusinessDays);
}

/** True once a queued job's due date has passed (date-only comparison, UTC). */
export function isOverdue(dueDate: Date | null, today: Date): boolean {
  if (!dueDate) return false;
  const due = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate()
  );
  const now = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate()
  );
  return due < now;
}
