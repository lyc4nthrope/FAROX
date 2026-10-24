import { Link } from "react-router-dom";

import { normalizeRole } from "../../auth/types";
import { DataTable, type DataTableColumn } from "../../../shared/ui";
import type { RoleListRow } from "../types";

// Presentacional pura (D1): listado de /roles sobre la primitiva DataTable
// (sdd/admin-console T-B2, D-M1). SIN controles de renombrar ni borrar en
// la fila (ADM-8.5): los 3 semilla se muestran inertes; un rol legacy (fuera
// de ROLE_NAMES, R3) se abre como link a su formulario, que es donde vive el
// rename/borrado protegido (T-C3).
export interface RoleTableProps {
  rows: RoleListRow[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() en el call site (HARD-1): jamás texto crudo.
  error: string | null;
}

// Rol legacy (R3): normalizeRole lo degrada a null ⇒ «sin rol» en runtime.
// El chip de aviso hace visible EXACTAMENTE esa degradación (ADM-8.3).
function esLegacy(name: string): boolean {
  return normalizeRole(name) === null;
}

const COLUMNAS: DataTableColumn<RoleListRow>[] = [
  {
    key: "nombre",
    header: "Nombre",
    // C0.4: toda fila enlaza a su edición (descripción).
    render: (row) => (
      <Link to={`/roles/${row.id}`} className="text-gray-900 underline">
        {row.name}
      </Link>
    ),
  },
  {
    key: "descripcion",
    header: "Descripción",
    render: (row) => row.description ?? "—",
  },
  {
    key: "aviso",
    header: "Aviso",
    render: (row) =>
      esLegacy(row.name) ? (
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          Rol no reconocido: degrada a «sin rol»
        </span>
      ) : (
        "—"
      ),
  },
];

export function RoleTable({ rows, loading, error }: RoleTableProps) {
  return (
    <DataTable<RoleListRow>
      columns={COLUMNAS}
      rows={rows}
      rowKey={(row) => String(row.id)}
      loading={loading}
      error={error}
      emptyTitle="Todavía no hay roles cargados."
      emptyHint="Los roles semilla (admin, operador, distribuidor) deberían existir en la DB."
    />
  );
}
