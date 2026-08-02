import type { ReactNode } from "react";
import SortLink from "./SortLink";
import EmptyState from "./EmptyState";

export type Column<T> = {
  /** Stable key; also the `?sort=` value when `sortable` is set. */
  key: string;
  header: ReactNode;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  className?: string;
  cell: (row: T) => ReactNode;
};

function alignClass(align?: "left" | "right" | "center"): string {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

/**
 * The house data table: a horizontally-scrollable, consistently-styled table
 * driven by a column spec. Sorting is opt-in per column via `SortLink` (URL
 * driven); search/pagination are separate primitives the page composes around
 * it. A server component — pass already-fetched rows.
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyMessage = "Nothing to show.",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyMessage?: ReactNode;
}) {
  if (rows.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted text-left">
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                className={`px-4 py-2 font-medium ${alignClass(column.align)} ${
                  column.className ?? ""
                }`.trim()}
              >
                {column.sortable ? (
                  <SortLink column={column.key}>{column.header}</SortLink>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-border/50 hover:bg-surface-2/40"
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-2 ${alignClass(column.align)} ${
                    column.className ?? ""
                  }`.trim()}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
