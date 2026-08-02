import { getViewer } from "@/lib/permissions/engine";
import { visibleNav } from "@/lib/nav";
import { ROLE_LABEL } from "@/lib/rbac";
import NavBar from "@/components/ui/NavBar";

/**
 * Server wrapper for the app shell nav: resolves the viewer (session + effective
 * permissions), filters the nav registry by what they can VIEW, and hands plain
 * data to the client `NavBar`. When signed out it renders a brand-only bar.
 */
export default async function Nav() {
  const viewer = await getViewer();
  const groups = viewer ? visibleNav(viewer) : [];
  return (
    <NavBar
      groups={groups}
      user={viewer ? { email: viewer.email, roleLabel: ROLE_LABEL[viewer.role] } : null}
    />
  );
}
