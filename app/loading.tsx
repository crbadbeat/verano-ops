/** Route-level loading fallback for the root segment. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-20 flex items-center justify-center">
      <div className="flex items-center gap-3 text-muted">
        <span
          aria-hidden
          className="h-4 w-4 rounded-full border-2 border-border border-t-ember motion-safe:animate-spin"
        />
        <span>Loading…</span>
      </div>
    </div>
  );
}
