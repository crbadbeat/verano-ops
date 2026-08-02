import { NextResponse } from "next/server";
import { netsuiteConfig } from "@/lib/netsuite";
import { syncNetsuiteOrders } from "@/lib/netsuite-orders-import";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// -----------------------------------------------------------------------------
// NetSuite ORDER sync. Pulls open sales orders for the synced subsidiaries
// (PGI + PGD, real customer orders only — intercompany='F') into the WMS review
// queue. Triggered by Vercel Cron (see vercel.json) with the CRON_SECRET bearer;
// also callable by hand with the same header, and with a `?since=YYYY-MM-DD`
// override (default: incremental from the newest order we've already synced).
// -----------------------------------------------------------------------------

async function run(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured on the server." },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!netsuiteConfig()) {
    return NextResponse.json(
      { ok: false, configured: false, message: "NetSuite credentials not set (NETSUITE_*)." },
      { status: 200 }
    );
  }

  const override = new URL(req.url).searchParams.get("since");
  try {
    const result = await syncNetsuiteOrders({ sinceOverride: override });
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}

export async function GET(req: Request): Promise<Response> {
  return run(req);
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}
