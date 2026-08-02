"use client"; // Error boundaries must be Client Components.

import Link from "next/link";
import { useEffect } from "react";

/**
 * Root error boundary. Next.js 16 passes `unstable_retry` to re-render the
 * segment; we also accept `reset` defensively across minor versions.
 */
export default function Error({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = unstable_retry ?? reset;

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-muted">
        This screen hit an unexpected error. Trying again reloads just this part
        of the page.
      </p>
      {error.digest && (
        <p className="text-xs text-muted font-mono">Reference: {error.digest}</p>
      )}
      <div className="flex justify-center gap-2">
        {retry && (
          <button type="button" onClick={() => retry()} className="btn btn-primary">
            Try again
          </button>
        )}
        <Link href="/" className="btn btn-ghost">
          Back to home
        </Link>
      </div>
    </div>
  );
}
