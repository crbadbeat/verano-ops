// Shared shape for the spreadsheet-upload server actions and the `Uploader`
// client that renders their result. Lives in lib (not on a page's actions file)
// so importers don't couple to whichever route currently owns a given uploader —
// the setup uploaders were re-homed from /inventory to /admin/data without this
// type having to move with them.
export interface UploadState {
  ok?: boolean;
  message?: string;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: string[];
}

/** Parse a spreadsheet quantity cell ("1,200" -> 1200); null if not a number. */
export function parseQty(raw: string): number | null {
  const n = Number(raw.replace(/[, ]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
