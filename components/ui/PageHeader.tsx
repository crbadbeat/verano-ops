import type { ReactNode } from "react";

/**
 * Standard page title block: an optional eyebrow, a balanced title, a short
 * description, and a right-aligned slot for primary actions.
 */
export default function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 flex-wrap">
      <div className="min-w-0">
        {eyebrow != null && (
          <p className="text-xs font-mono uppercase tracking-widest text-muted mb-1">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-bold tracking-tight text-balance">{title}</h1>
        {description != null && (
          <p className="text-muted mt-1 max-w-2xl">{description}</p>
        )}
      </div>
      {actions != null && (
        <div className="ml-auto flex items-center gap-2 flex-wrap">{actions}</div>
      )}
    </div>
  );
}
