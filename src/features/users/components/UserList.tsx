import { Link } from "react-router-dom";

import { roleLabel } from "../../../app/shell/navigation";
import { normalizeRole } from "../../auth/types";
import { DataTable, type DataTableColumn } from "../../../shared/ui";
import type { UserListRow } from "../types";

// Presentacional pura (D1): listado de /users sobre la primitiva DataTable
// (sdd/admin-console T-B2, D-M1). SIN controles de creación ni borrado de
// usuarios (ADM-3.2 · D3: el alta es auto-registro público y la baja es
// is_active, nunca DELETE — delete no tiene policy y es imposible por diseño).
export interface UserListProps {
  rows: UserListRow[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() vía useList (HARD-1): jamás texto crudo.
  error: string | null;
}

// Rol desconocido (R3) ⇒ normalizeRole lo degrada a null ⇒ «Sin rol», que es
// EXACTAMENTE cómo la app trata a esos usuarios en runtime.
function rolVisible(roleName: string | null): string {
  return roleLabel(normalizeRole(roleName));
}

const COLUMNAS: DataTableColumn<UserListRow>[] = [
  { key: "nombre", header: "Nombre", render: (row) => (
    <Link to={`/users/${row.id}`} className="text-gray-900 underline">
      {row.full_name}
    </Link>
  ) },
  { key: "email", header: "Email", render: (row) => row.email ?? "—" },
  {
    key: "rol",
    header: "Rol",
    render: (row) => (
      <span className="rounded bg-gray-900 px-2 py-0.5 text-xs font-medium text-white">
        {rolVisible(row.role_name)}
      </span>
    ),
  },
  {
    key: "premium",
    header: "Premium",
    render: (row) =>
      row.premium ? (
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          Premium
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "estado",
    header: "Estado",
    render: (row) => (
      <span className={row.is_active ? "text-gray-700" : "text-gray-400"}>
        {row.is_active ? "Activo" : "Inactivo"}
      </span>
    ),
  },
  {
    key: "tiendas",
    header: "Tiendas",
    // FLAG-4: null = la query de apoyo falló (o aún no resolvió) ⇒ «—», sin
    // romper la lista por el GRANT D2a.
    render: (row) => (row.store_count === null ? "—" : String(row.store_count)),
  },
];

export function UserList({ rows, loading, error }: UserListProps) {
  return (
    <DataTable<UserListRow>
      columns={COLUMNAS}
      rows={rows}
      rowKey={(row) => row.id}
      loading={loading}
      error={error}
      emptyTitle="Todavía no hay usuarios registrados."
      emptyHint="Cuando haya usuarios, van a aparecer acá."
    />
  );
}
