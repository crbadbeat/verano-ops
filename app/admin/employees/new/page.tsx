import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import PageHeader from "@/components/ui/PageHeader";
import NewEmployeeForm from "@/components/admin/NewEmployeeForm";

export const dynamic = "force-dynamic";

export default async function NewEmployeePage() {
  const me = await getViewer();
  if (!can(me, "admin.employees:view")) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <Link href="/admin/employees" className="text-muted hover:text-foreground text-sm">
        ← Employees
      </Link>
      <PageHeader
        eyebrow="Admin"
        title="Add employee"
        description="Create the person record. Division & NetSuite ids, sales level, org position and a login are set on their page next."
      />
      <NewEmployeeForm />
    </div>
  );
}
