import { redirect } from "next/navigation";

// Locations & bins moved into the Admin area. This shim keeps old links and
// bookmarks (and other tracks' inbound links) working after the re-home.
export default function LocationsMoved() {
  redirect("/admin/locations");
}
