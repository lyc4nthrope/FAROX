import type { ReactNode } from "react";

import { EmptyState } from "../EmptyState";
import { ErrorBanner } from "../ErrorBanner";

// sdd/admin-console T-B2 · decisión D-M1 (design #599 §1): primitiva
// presentacional compartida de listados. Sirve a users, roles y audit (y en el
// lote C al motor de catálogos); NO conoce supabase, hooks ni features — solo
// recibe props puras. Vacío NO es error (D4): error ⇒ ErrorBanner · loading ⇒
// "Cargando…" · vacío ⇒ EmptyState · filas ⇒ tabla (nunca más de uno a la vez).
export interface DataTableColumn<Row> {
  /** Clave estable de la columna (encabezado del <th>). */
  key: string;
  header: string;
  /** Renderiza la celda de esta fila (el caller decide badge, link, etc.). */
  render: (row: Row) => ReactNode;
}

export interface DataTableAction<Row> {
  key: string;
  label: string;
  /** Aparece solo si devuelve true (default: siempre). */
  visible?: (row: Row) => boolean;
  /** Control deshabilitado (el copy de deshabilitado viaja en `title`). */
  disabled?: (row: Row) => boolean;
  title?: (row: Row) => string;
  onClick: (row: Row) => void;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  /** Identidad de la fila para la key de React. */
  rowKey: (row: Row) => string;
  loading: boolean;
  /** SIEMPRE mapeado por mapError() en el call site (HARD-1): jamás texto crudo. */
  error: string | null;
  emptyTitle: string;
  emptyHint?: string;
  /** Columna extra de botones por fila (opcional). */
  actions?: DataTableAction<Row>[];
  /** Render bajo la tabla (paginación, avisos). */
  footer?: ReactNode;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  emptyTitle,
  emptyHint,
  actions,
  footer,
}: DataTableProps<Row>) {
  if (error !== null) {
    return (
      <div className="mt-4 overflow-x-auto">
        <ErrorBanner message={error} />
      </div>
    );
  }
  if (loading) {
    return <p className="mt-4 text-sm text-gray-600">Cargando…</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="mt-4 overflow-x-auto">
        <EmptyState title={emptyTitle} hint={emptyHint} />
      </div>
    );
  }

  const visibles = (row: Row): DataTableAction<Row>[] =>
    (actions ?? []).filter((action) => action.visible?.(row) ?? true);

  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-gray-600">
            {columns.map((column) => (
              <th key={column.key} className="py-2 font-medium">
                {column.header}
              </th>
            ))}
            {(actions ?? []).length > 0 && (
              <th className="py-2 font-medium">Acciones</th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-gray-100">
              {columns.map((column) => (
                <td key={column.key} className="py-2 text-gray-700">
                  {column.render(row)}
                </td>
              ))}
              {(actions ?? []).length > 0 && (
                <td className="py-2">
                  <span className="flex gap-2">
                    {visibles(row).map((action) => (
                      <button
                        key={action.key}
                        type="button"
                        disabled={action.disabled?.(row) ?? false}
                        title={action.title?.(row)}
                        onClick={() => action.onClick(row)}
                        className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {action.label}
                      </button>
                    ))}
                  </span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  );
}
