import { Link } from "react-router-dom";

import { EmptyState, ErrorBanner } from "../../../shared/ui";
import type { StoreListRow } from "../types";

export interface StoreListProps {
  rows: StoreListRow[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() vía useList (HARD-1): jamás texto crudo.
  error: string | null;
  // SEC-01 (idea:114): admin y operador CREAN tiendas — el operador es su
  // ruta de bootstrap de alcance (D35), README:38-39 está MAL (flag-only
  // obs #480). distribuidor no llega acá (ruta con RequireRole, §S2 "NO").
  canCreate: boolean;
}

// Presentacional pura (D1): listado de tiendas (§S2 fila /stores · STORE-2,
// spec #483 S6 · idea:68/207 CRUD de Tiendas). Muestra nombre, ciudad y las
// coordenadas lat/lng — leídas de stores_geo (server-computed, Base:165). En
// la DB la lista NO está scopeada (stores_select USING true, 0006:164-165): el
// scope del operador lo aplica la capa api vía my_store_ids (§S2 "operador
// own"; ocultar es UX — idea:134). Vacío ⇒ EmptyState; error ⇒ ErrorBanner —
// nunca ambos (vacío ≠ error, D4).
export function StoreList({ rows, loading, error, canCreate }: StoreListProps) {
  return (
    <div className="mt-4">
      {canCreate && (
        <Link
          to="/stores/new"
          className="inline-block rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Nueva tienda
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
            title="No hay tiendas todavía"
            hint="Cuando registres tiendas, van a aparecer acá."
          />
        </div>
      )}
      {error === null && loading && <p className="mt-4 text-sm text-gray-600">Cargando…</p>}
      {error === null && !loading && rows.length > 0 && (
        <table className="mt-4 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="py-2 font-medium">Nombre</th>
              <th className="py-2 font-medium">Ciudad</th>
              <th className="py-2 font-medium">Latitud</th>
              <th className="py-2 font-medium">Longitud</th>
              <th className="py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100">
                <td className="py-2">
                  <Link to={`/stores/${row.id}`} className="text-gray-900 underline">
                    {row.name}
                  </Link>
                </td>
                <td className="py-2 text-gray-700">{row.city ?? "—"}</td>
                <td className="py-2 text-gray-700">{row.lat}</td>
                <td className="py-2 text-gray-700">{row.lng}</td>
                <td className="py-2 text-gray-700">{row.is_active ? "Activo" : "Inactivo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
