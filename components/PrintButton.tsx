"use client";

import type { ReactNode } from "react";

export default function PrintButton({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className ?? "btn btn-primary"}
      onClick={() => window.print()}
    >
      {children ?? "Print labels"}
    </button>
  );
}
