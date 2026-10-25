import { Link } from "react-router-dom";

import { formatQty } from "../../../shared/lib/format";
import { EmptyState, ErrorBanner } from "../../../shared/ui";
import type { ProductListRow } from "../types";

export interface ProductListProps {
  // El catálogo de una tienda agrega la cantidad en stock; el global y el del
  // distribuidor no la traen (quantity ausente/null).
  rows: (ProductListRow & { quantity?: number | null })[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() vía useList/useLoad (HARD-1): jamás texto crudo.
  error: string | null;
  // Columna "Cantidad" (catálogo de tienda).
  quantity?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
}

// Presentacional pura (D1): tabla de productos. Muestra marca/unidad/categoría
// (embebidas en 1 request — sin N+1) y el estado. Vacío ⇒ EmptyState;
// error ⇒ ErrorBanner — nunca ambos (vacío ≠ error, D4).
export function ProductList({
  rows,
  loading,
  error,
  quantity = false,
  emptyTitle = "No hay productos todavía",
  emptyHint = "Cuando haya productos, van a aparecer acá.",
}: ProductListProps) {
  return (
    <div className="mt-4">
      {error !== null && <ErrorBanner message={error} />}
      {error === null && !loading && rows.length === 0 && (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      )}
      {error === null && loading && <p className="text-sm text-gray-600">Cargando…</p>}
      {error === null && !loading && rows.length > 0 && (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="py-2 font-medium">Nombre</th>
              <th className="py-2 font-medium">Marca</th>
              <th className="py-2 font-medium">Unidad</th>
              <th className="py-2 font-medium">Categoría</th>
              {quantity && <th className="py-2 font-medium">Cantidad</th>}
              <th className="py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100">
                <td className="py-2">
                  <Link to={`/products/${row.id}`} className="text-gray-900 underline">
                    {row.name}
                  </Link>
                </td>
                <td className="py-2 text-gray-700">{row.brand?.name ?? "—"}</td>
                <td className="py-2 text-gray-700">{row.unit?.name ?? "—"}</td>
                <td className="py-2 text-gray-700">{row.category?.name ?? "—"}</td>
                {quantity && (
                  <td className="py-2 text-gray-700">
                    {row.quantity === null || row.quantity === undefined
                      ? "—"
                      : formatQty(row.quantity)}
                  </td>
                )}
                <td className="py-2 text-gray-700">{row.is_active ? "Activo" : "Inactivo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
