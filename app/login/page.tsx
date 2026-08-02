import { prisma } from "@/lib/db";
import LoginForm from "@/components/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Registration is only offered while no account exists yet (the one-time admin
  // bootstrap). After that, accounts are created by an admin via invite.
  const canRegister = (await prisma.user.count()) === 0;
  return <LoginForm canRegister={canRegister} />;
}
