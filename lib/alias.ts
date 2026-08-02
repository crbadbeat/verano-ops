// Normalizes a scan-alias value into a stable lookup key so the same logical
// item always resolves to the same Product, regardless of casing or stray
// whitespace differences between how it was typed or scanned.

function norm(v?: string | null): string {
  return (v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Build the normalized lookup key for a scan alias. Callers key on the alias's
 * detail value (falling back to the alias text when the detail is absent).
 */
export function matchKey(value: string | null | undefined): string {
  return norm(value);
}
