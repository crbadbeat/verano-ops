import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import PageHeader from "@/components/ui/PageHeader";
import AdpImportForm from "@/components/admin/AdpImportForm";

export const dynamic = "force-dynamic";

export default async function AdpImportPage() {
  const me = await getViewer();
  if (!can(me, "admin.employees:view")) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <Link href="/admin/employees" className="text-muted hover:text-foreground text-sm">
        ← Employees
      </Link>
      <PageHeader
        eyebrow="Admin"
        title="Import from ADP"
        description="Load or re-sync the employee directory from an ADP export. Sensitive file — it is processed in memory and never stored."
      />
      <AdpImportForm />
    </div>
  );
}
