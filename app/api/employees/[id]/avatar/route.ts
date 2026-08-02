import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// Serves an employee's stored profile photo. Behind the app session; the URL is
// versioned (?v=avatarUpdatedAt) so it can be cached hard and busted on change.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const versioned = new URL(_req.url).searchParams.has("v");
  const emp = await prisma.employee.findUnique({ where: { id }, select: { avatar: true, avatarMime: true } });
  if (!emp?.avatar) {
    // Cache the miss briefly so photoless reps don't 404 on every card render.
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, max-age=300" } });
  }

  const bytes = new Uint8Array(emp.avatar as Uint8Array);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": emp.avatarMime ?? "image/webp",
      // Versioned URLs (?v=updatedAt) are immutable; unversioned get a short TTL so
      // a new photo still shows up on the reporting pages within a few minutes.
      "Cache-Control": versioned ? "private, max-age=31536000, immutable" : "private, max-age=300",
    },
  });
}
