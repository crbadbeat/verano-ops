import Link from "next/link";

/** Root 404. */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center space-y-4">
      <p className="text-sm font-mono uppercase tracking-widest text-muted">404</p>
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="text-muted">
        That page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <div className="flex justify-center">
        <Link href="/" className="btn btn-primary">
          Back to home
        </Link>
      </div>
    </div>
  );
}
