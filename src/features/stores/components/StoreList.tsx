import { Link } from "react-router-dom";

import { EmptyState, ErrorBanner, ResponsiveTable } from "../../../shared/ui";
import { Badge, buttonClass } from "../../../shared/ui/Box";
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-medium text-gray-500">
            {rows.length > 0
              ? `${rows.length} ${rows.length === 1 ? "tienda" : "tiendas"} en esta página`
              : "Sin tiendas para mostrar"}
          </span>
          <Link to="/stores/new" className={buttonClass}>
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Nueva tienda
          </Link>
        </div>
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
      {error === null && loading && <p className="mt-4 text-sm text-gray-500">Cargando…</p>}
      {error === null && !loading && rows.length > 0 && (
        <div className="mt-4">
          <ResponsiveTable
            caption="Tiendas"
            columns={[
              {
                key: "name",
                header: "Nombre",
                primary: true,
                render: (row) => (
                  <Link
                    to={`/stores/${row.id}`}
                    className="font-medium text-gray-900 underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                ),
              },
              { key: "city", header: "Ciudad", render: (row) => row.city ?? "—" },
              {
                key: "lat",
                header: "Latitud",
                className: "tabular-nums text-gray-500",
                render: (row) => row.lat,
              },
              {
                key: "lng",
                header: "Longitud",
                className: "tabular-nums text-gray-500",
                render: (row) => row.lng,
              },
              {
                key: "status",
                header: "Estado",
                render: (row) => (
                  <Badge tone={row.is_active ? "green" : "gray"}>
                    {row.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                ),
              },
            ]}
            rows={rows}
            rowKey={(row) => String(row.id)}
          />
        </div>
      )}
    </div>
  );
}
