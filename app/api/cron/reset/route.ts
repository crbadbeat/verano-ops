import { NextResponse } from "next/server";
import { runDemoSeed } from "@/lib/demo/seed-demo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// -----------------------------------------------------------------------------
// Demo reset: wipes and reseeds the whole demo database to a known-good state.
// Triggered nightly by Vercel Cron (see vercel.json), which sends
// `Authorization: Bearer $CRON_SECRET`. Also callable by hand with the same
// header to seed a fresh database or heal a griefed demo.
// -----------------------------------------------------------------------------
async function run(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured." }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  const summary = await runDemoSeed();
  return NextResponse.json({ ok: true, ms: Date.now() - startedAt, summary });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
