import { Link } from "react-router-dom";

import { EmptyState, ErrorBanner } from "../../../shared/ui";
import type { DistributorListRow, DistributorUserCounts } from "../types";

export interface DistributorListProps {
  rows: DistributorListRow[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() vía useList (HARD-1): jamás texto crudo.
  error: string | null;
  // SEC-01 (idea:119): solo admin escribe; operador es solo lectura. Ocultar
  // es UX, no seguridad (idea:134) — el enforcement vive en las policies.
  canWrite: boolean;
  // sdd/admin-console T-E2: columna admin «Usuarios asignados». Ausencia del
  // prop (undefined) = sin columna (sesión no-admin); null = la query de
  // apoyo falló ⇒ celdas «—» sin romper la lista (mismo fallback FLAG-4).
  userCounts?: DistributorUserCounts | null;
}

// Presentacional pura (D1): listado de distribuidores (§S2 fila /distributors,
// DIST-01 FAROX-72). Vacío ⇒ EmptyState; error ⇒ ErrorBanner — nunca ambos
// (vacío ≠ error, D4).
export function DistributorList({
  rows,
  loading,
  error,
  canWrite,
  userCounts,
}: DistributorListProps) {
  return (
    <div className="mt-4">
      {canWrite && (
        <Link
          to="/distributors/new"
          className="inline-block rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Nuevo distribuidor
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
            title="No hay distribuidores todavía"
            hint="Cuando haya distribuidores, van a aparecer acá."
          />
        </div>
      )}
      {error === null && loading && <p className="mt-4 text-sm text-gray-600">Cargando…</p>}
      {error === null && !loading && rows.length > 0 && (
        <table className="mt-4 w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-600">
              <th className="py-2 font-medium">Nombre</th>
              <th className="py-2 font-medium">NIT</th>
              <th className="py-2 font-medium">Estado</th>
              {userCounts !== undefined && (
                <th className="py-2 font-medium">Usuarios asignados</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-100">
                <td className="py-2">
                  <Link to={`/distributors/${row.id}`} className="text-gray-900 underline">
                    {row.name}
                  </Link>
                </td>
                <td className="py-2 text-gray-700">{row.nit}</td>
                <td className="py-2 text-gray-700">{row.is_active ? "Activo" : "Inactivo"}</td>
                {userCounts !== undefined && (
                  <td className="py-2 text-gray-700">
                    {userCounts === null ? "—" : String(userCounts[row.id] ?? 0)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
