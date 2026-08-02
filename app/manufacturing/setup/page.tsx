import { redirect } from "next/navigation";

// Manufacturing setup moved into the Admin area. This shim keeps old links and
// bookmarks (including the Build-floor link) working after the re-home.
export default function ManufacturingSetupMoved() {
  redirect("/admin/manufacturing");
}
