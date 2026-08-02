import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PageHeader from "@/components/ui/PageHeader";
import ChangePasswordForm from "@/components/ChangePasswordForm";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const me = await getSessionUser();
  if (!me) notFound();

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    select: { mustResetPassword: true },
  });
  const forced = !!user?.mustResetPassword;

  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-6">
      <PageHeader
        eyebrow="Profile"
        title="Change password"
        description={
          forced
            ? "Set a new password to finish setting up your account."
            : "Update the password you use to sign in."
        }
      />
      {forced && (
        <div className="card border-ember/40 p-4 text-sm text-ember">
          You&apos;re signed in with a temporary password — please set a new one to continue.
        </div>
      )}
      <div className="card p-5">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
