import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { formatQty } from "../../../shared/lib/format";
import { EmptyState, ErrorBanner } from "../../../shared/ui";
import { Badge } from "../../../shared/ui/Box";
import type { ProductListRow } from "../types";

// Fila del listado + los extras del catálogo de tienda: cantidad en stock
// (null en el catálogo del distribuidor) y faltante marcado (0022).
export type ProductRowView = ProductListRow & {
  quantity?: number | null;
  is_shortage?: boolean;
};

export interface ProductListProps {
  // El catálogo de una tienda agrega la cantidad en stock; el global y el del
  // distribuidor no la traen (quantity ausente/null).
  rows: ProductRowView[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() vía useList/useLoad (HARD-1): jamás texto crudo.
  error: string | null;
  // Columna "Cantidad" (catálogo de tienda).
  quantity?: boolean;
  // Control propio de la columna Cantidad (editor + guardar). Sin esto se
  // muestra el número formateado.
  renderQuantity?: (row: ProductRowView) => ReactNode;
  // Acción por fila (catálogo propio: quitar/faltante). Sin esto la tabla es de
  // solo lectura.
  renderAction?: (row: ProductRowView) => ReactNode;
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
  renderQuantity,
  renderAction,
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
        <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="py-2 font-medium">Nombre</th>
              <th className="py-2 font-medium">Marca</th>
              <th className="py-2 font-medium">Unidad</th>
              <th className="py-2 font-medium">Categoría</th>
              {quantity && <th className="py-2 font-medium">Cantidad</th>}
              <th className="py-2 font-medium">Estado</th>
              {renderAction !== undefined && <th className="py-2 font-medium">Acción</th>}
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
                    {renderQuantity !== undefined ? (
                      renderQuantity(row)
                    ) : row.quantity === null || row.quantity === undefined ? (
                      "—"
                    ) : (
                      formatQty(row.quantity)
                    )}
                  </td>
                )}
                <td className="py-2 text-gray-700">
                  <div className="flex items-center gap-2">
                    <span>{row.is_active ? "Activo" : "Inactivo"}</span>
                    {row.is_shortage === true && <Badge tone="amber">Faltante</Badge>}
                  </div>
                </td>
                {renderAction !== undefined && <td className="py-2">{renderAction(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}
