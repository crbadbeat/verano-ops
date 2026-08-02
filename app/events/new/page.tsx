import Link from "next/link";
import { getViewer } from "@/lib/permissions/engine";
import { notFound } from "next/navigation";
import { can } from "@/lib/rbac";
import PageHeader from "@/components/ui/PageHeader";
import NewEventForm from "@/components/events/NewEventForm";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const me = await getViewer();
  if (!can(me, "events:edit")) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-6">
      <PageHeader
        eyebrow="PGI"
        title="New show"
        description="Start with a name — you can fill in dates, staffing, costs and goals on the show once it's created."
        actions={<Link href="/events" className="btn btn-ghost text-sm">← All shows</Link>}
      />
      <NewEventForm />
    </div>
  );
}
