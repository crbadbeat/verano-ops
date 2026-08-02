import { NextResponse } from "next/server";
import { runSimulateTick } from "@/lib/demo/simulate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// -----------------------------------------------------------------------------
// Demo simulator tick: a few new orders + show sales so the demo feels live.
// Guarded by CRON_SECRET (Bearer). Drive it every ~15-30 min from Vercel Cron
// (Pro), a GitHub Action, or any external scheduler.
// -----------------------------------------------------------------------------
async function run(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await runSimulateTick();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
