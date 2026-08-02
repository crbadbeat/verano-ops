/**
 * Keep in step with `serverActions.bodySizeLimit` in next.config.ts.
 *
 * A request body over that limit is rejected by the framework before the Server
 * Action runs, so the server cannot return a friendly message — it is an instant
 * 500 with nothing to catch. Checking on the client is the only way to explain
 * it. The margin covers the boundaries and part headers multipart adds.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 - 64 * 1024;

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

/** A message when the form's chosen file is too big, otherwise null. */
export function tooLargeMessage(form: HTMLFormElement): string | null {
  const input = form.elements.namedItem("file");
  const file = input instanceof HTMLInputElement ? input.files?.[0] : null;
  if (!file || file.size <= MAX_UPLOAD_BYTES) return null;
  return `That file is ${mb(file.size)} MB, over the ${mb(MAX_UPLOAD_BYTES)} MB upload limit.`;
}
