import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Liveness + connectivity probe. Public (allowed in proxy.ts).
// GET /api/health -> DB connectivity + row counts
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const result: Record<string, unknown> = { ok: true };

  try {
    result.db = "connected";
    result.users = await prisma.user.count();
    result.products = await prisma.product.count();
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: "error", message: (e as Error).message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ...result, ms: Date.now() - startedAt });
}
