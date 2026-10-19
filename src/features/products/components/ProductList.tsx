import { Link } from "react-router-dom";

import { EmptyState, ErrorBanner } from "../../../shared/ui";
import type { ProductListRow } from "../types";

export interface ProductListProps {
  rows: ProductListRow[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() vía useList (HARD-1): jamás texto crudo.
  error: string | null;
  // SEC-01 (idea:113): admin y operador CREAN productos; distribuidor solo
  // lee el catálogo de uso general. Ocultar es UX, no seguridad (idea:134) —
  // el enforcement vive en products_insert (0006:146-149).
  canCreate: boolean;
}

// Presentacional pura (D1): listado de productos (§S2 fila /products · PROD-1,
// spec #483 S5 · idea:206 CRUD de Productos). Muestra marca/unidad/categoría
// (embebidas en el request del listado, Base:698 — sin N+1) y el estado.
// Vacío ⇒ EmptyState; error ⇒ ErrorBanner — nunca ambos (vacío ≠ error, D4).
export function ProductList({ rows, loading, error, canCreate }: ProductListProps) {
  return (
    <div className="mt-4">
      {canCreate && (
        <Link
          to="/products/new"
          className="inline-block rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Nuevo producto
        </Link>
      )}
      {error !== null && (
        <div className="mt-4">
          <ErrorBanner message={error} />
        </div>
      )}
      {error === null && !loading && rows.length === 0 && (
        <div className="mt-4">
          <EmptyState
            title="No hay productos todavía"
            hint="Cuando haya productos, van a aparecer acá."
          />
        </div>
      )}
      {error === null && loading && <p className="mt-4 text-sm text-gray-600">Cargando…</p>}
      {error === null && !loading && rows.length > 0 && (
        <table className="mt-4 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="py-2 font-medium">Nombre</th>
              <th className="py-2 font-medium">Marca</th>
              <th className="py-2 font-medium">Unidad</th>
              <th className="py-2 font-medium">Categoría</th>
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
                <td className="py-2 text-gray-700">{row.is_active ? "Activo" : "Inactivo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
