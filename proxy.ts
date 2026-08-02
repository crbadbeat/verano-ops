import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/invite",
  "/api/health",
  "/api/sync", // guarded by CRON_SECRET bearer, not the session cookie
  "/api/cron", // guarded by CRON_SECRET bearer, not the session cookie
];

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("pw_session")?.value;
  if (!token) return false;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (await hasValidSession(req)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

// Protect everything except Next internals, the login route, and static assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};
