import { Link } from "react-router-dom";

import { EmptyState, ErrorBanner } from "../../../shared/ui";
import type { UserStoreRow } from "../types";

export interface UserStoresPanelProps {
  stores: UserStoreRow[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() en el contenedor (HARD-1): jamás texto crudo.
  error: string | null;
}

// Presentacional pura (D1) · sdd/admin-console T-B8 (ADM-7): SOLO LECTURA de
// user_stores — la mutación de asignación (assign_user_stores) queda FUERA de
// este alcance (spec Non-goals). El select vive en la capa api (con el único
// filtro por user_id); en runtime sin el GRANT D2a el error llega acá como
// ErrorBanner amigable, nunca un crash (invariante I4 del design).
// T-E3 (in-scope #5): cada tienda linkea a /stores/:id — cross-navigation
// hacia la pantalla existente de Tiendas (router.tsx, ruta admin|operador).
export function UserStoresPanel({ stores, loading, error }: UserStoresPanelProps) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">Tiendas asignadas</h2>
      <p className="mt-1 text-sm text-gray-600">Vista de solo lectura.</p>
      {error !== null && (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      )}
      {error === null && loading && (
        <p className="mt-2 text-sm text-gray-600">Cargando…</p>
      )}
      {error === null && !loading && stores.length === 0 && (
        <div className="mt-2">
          <EmptyState title="Sin tiendas asignadas" />
        </div>
      )}
      {error === null && !loading && stores.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-gray-700">
          {stores.map((store) => (
            <li key={store.store_id}>
              <Link
                to={`/stores/${store.store_id}`}
                className="text-gray-900 underline"
              >
                {store.store_name ?? `Tienda #${store.store_id}`}
              </Link>
              {store.store_city !== null && (
                <span className="text-gray-500"> · {store.store_city}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
