import { redirect } from "next/navigation";

// Moved to /admin/locations/labels; preserve the ?wh= warehouse filter.
export default async function LocationLabelsMoved({
  searchParams,
}: {
  searchParams: Promise<{ wh?: string }>;
}) {
  const { wh } = await searchParams;
  redirect(wh ? `/admin/locations/labels?wh=${wh}` : "/admin/locations/labels");
}
