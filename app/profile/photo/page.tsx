import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { employeeName } from "@/lib/employees";
import PageHeader from "@/components/ui/PageHeader";
import AvatarUploader from "@/components/employees/AvatarUploader";

export const dynamic = "force-dynamic";

export default async function ProfilePhotoPage() {
  const me = await getSessionUser();
  if (!me) notFound();

  const emp = await prisma.employee.findFirst({
    where: { userId: me.id },
    select: { id: true, name: true, firstName: true, lastName: true, avatarUpdatedAt: true },
  });

  return (
    <div className="mx-auto max-w-lg px-4 py-10 space-y-6">
      <PageHeader
        eyebrow="Profile"
        title="Your photo"
        description="Your photo shows up on the sales wall board when you close a deal. Make it a good one."
      />
      {emp ? (
        <div className="card p-5 space-y-3">
          <AvatarUploader employeeId={emp.id} name={employeeName(emp)} version={emp.avatarUpdatedAt?.getTime() ?? null} />
        </div>
      ) : (
        <div className="card p-6 text-sm text-muted">
          Your login isn&apos;t linked to an employee record yet — ask an admin to link it, then you can add your photo here.
        </div>
      )}
    </div>
  );
}
