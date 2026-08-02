import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createReturn } from "./actions";

export const dynamic = "force-dynamic";

export default async function ReturnsPage() {
  const user = await getSessionUser();

  const [queue, closed] = await Promise.all([
    prisma.returnOrder.findMany({
      where: { status: "FLAGGED" },
      orderBy: { createdAt: "asc" },
      include: { lines: true, createdBy: { select: { email: true } } },
    }),
    prisma.returnOrder.findMany({
      where: { status: { in: ["CHECKED_IN", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { lines: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Returns</h1>
        <p className="text-muted mt-1">
          Flag what&apos;s coming back (delivery no-show, unsold show units); the
          returns desk checks it in. Anything that never comes back stays visible as
          a shortfall.
        </p>
      </div>

      {user && (
        <div className="card p-5">
          <h3 className="font-semibold">Flag a return</h3>
          <form action={createReturn} className="mt-3 flex flex-col sm:flex-row gap-3">
            <input
              name="reference"
              placeholder="Order # / trip reference"
              className="input"
            />
            <input
              name="reason"
              placeholder="Reason (no-show, unsold show unit…)"
              className="input"
            />
            <button className="btn btn-primary whitespace-nowrap" type="submit">
              Flag return
            </button>
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold">Check-in queue</h2>
          <span className="badge text-ember">{queue.length}</span>
        </div>
        {queue.length === 0 ? (
          <div className="p-10 text-center text-muted">Nothing waiting to come back.</div>
        ) : (
          <ul className="divide-y divide-border/60">
            {queue.map((r) => {
              const expected = r.lines.reduce((s, l) => s + l.expectedQty, 0);
              const gotBack = r.lines.reduce((s, l) => s + l.checkedInQty, 0);
              return (
                <li key={r.id}>
                  <Link
                    href={`/returns/${r.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {r.reference ?? "Return"}
                      </div>
                      <div className="text-xs text-muted truncate">
                        {r.reason ?? "—"} · {r.lines.length} lines ·{" "}
                        {r.createdBy?.email ?? ""}
                      </div>
                    </div>
                    <span className="ml-auto text-sm tabular-nums text-muted">
                      {gotBack}/{expected} back
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {closed.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Recently closed</h2>
          </div>
          <ul className="divide-y divide-border/60">
            {closed.map((r) => {
              const expected = r.lines.reduce((s, l) => s + l.expectedQty, 0);
              const gotBack = r.lines.reduce((s, l) => s + l.checkedInQty, 0);
              const short = expected - gotBack;
              return (
                <li key={r.id}>
                  <Link
                    href={`/returns/${r.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/40"
                  >
                    <div className="min-w-0">
                      <div className="truncate">{r.reference ?? "Return"}</div>
                      <div className="text-xs text-muted">{r.status}</div>
                    </div>
                    <span className="ml-auto text-sm tabular-nums">
                      {gotBack}/{expected}
                      {short > 0 && (
                        <span className="text-danger"> · {short} short</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
