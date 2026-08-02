import type { ReactNode } from "react";

/** The consistent "nothing here yet" panel used inside cards and tables. */
export default function EmptyState({
  title,
  message,
  action,
}: {
  title?: ReactNode;
  message: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="p-10 text-center">
      {title != null && <p className="font-semibold">{title}</p>}
      <p className="text-muted mt-1">{message}</p>
      {action != null && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
