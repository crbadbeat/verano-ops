import Link from "next/link";
import { prisma } from "@/lib/db";
import { hashInviteToken } from "@/lib/invite";
import SetPasswordForm from "@/components/SetPasswordForm";

export const dynamic = "force-dynamic";

/**
 * Invite acceptance. A user follows their one-time link and sets their own
 * password. Public (added to proxy's PUBLIC_PATHS) since they are not yet
 * authenticated. The token is validated here for a clean message, and again in
 * the action before anything is written.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  const record = token
    ? await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashInviteToken(token) },
        include: { user: { select: { email: true, name: true, active: true } } },
      })
    : null;

  const valid =
    !!record && !record.usedAt && record.expiresAt > new Date() && record.user.active;

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="card p-8">
        {valid ? (
          <>
            <h1 className="text-2xl font-bold">Set your password</h1>
            <p className="text-muted text-sm mt-1">
              Welcome{record!.user.name ? `, ${record!.user.name}` : ""}. Choose a
              password for <span className="text-foreground">{record!.user.email}</span> to
              finish setting up your account.
            </p>
            <SetPasswordForm token={token!} />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">Link not valid</h1>
            <p className="text-muted text-sm mt-2">
              This invite link has expired, was already used, or is incorrect. Ask an
              administrator to send you a new one.
            </p>
            <Link href="/login" className="btn btn-ghost mt-6 inline-block">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
