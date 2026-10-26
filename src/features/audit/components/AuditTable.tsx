import { DataTable, type DataTableColumn } from "../../../shared/ui";
import type { AuditAction, AuditRow } from "../types";

// sdd/admin-console T-D2 · presentacional pura (D1): visor de audit_log sobre
// la primitiva DataTable (T-B2, D-M1). SIN controles de escritura — la tabla
// es append-only y el DML está revocado hasta para el rol de servicio
// (0006:351-357 + 0011:551-554): no hay nada que crear, editar ni borrar
// (ADM-10.3). Sin acciones por fila (sin prop `actions` ⇒ sin columna
// «Acciones»). Recibe props puras: no conoce supabase, hooks ni router.

export interface AuditTableProps {
  rows: AuditRow[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() en el call site (HARD-1): jamás texto crudo.
  error: string | null;
  hasMore: boolean;
  cargandoMas: boolean;
  onCargarMas: () => void;
}

// Chips de acción (enum server audit_action, 0001:94) en español.
const ACCION_LABEL: Record<AuditAction, string> = {
  insert: "Alta",
  update: "Modificación",
  delete: "Borrado",
};

const ACCION_CLASE: Record<AuditAction, string> = {
  insert: "bg-emerald-100 text-emerald-800",
  update: "bg-gray-100 text-gray-700",
  delete: "bg-red-100 text-red-800",
};

const MAX_VALUE_CHARS = 48;

// Formatea UN valor del jsonb sin volcar JSON crudo al DOM: primitivas van
// truncadas; estructuras anidadas se marcan como complejas (nunca se
// serializa el objeto entero — render defensivo mandato T-D1).
export function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined) return "vacío";
  if (typeof value === "string") {
    if (value === "") return "(vacío)";
    return value.length > MAX_VALUE_CHARS
      ? `${value.slice(0, MAX_VALUE_CHARS)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "[valor complejo]";
}

type Cambio = { columna: string; valor: unknown };

// diff jsonb = SOLO las columnas cambiadas (D10, 0003:263). Se interpreta de
// forma defensiva: objeto ⇒ pares columna→valor; array ⇒ lista de cambios;
// null/primitivo ⇒ se muestra tal cual. Lo que no se entiende, no rompe.
export function diffCambios(diff: unknown): Cambio[] {
  if (typeof diff === "object" && diff !== null && !Array.isArray(diff)) {
    return Object.entries(diff as Record<string, unknown>).map(([columna, valor]) => ({
      columna,
      valor,
    }));
  }
  if (Array.isArray(diff)) {
    return diff.map((valor, index) => ({ columna: `cambio ${index + 1}`, valor }));
  }
  return [];
}

// Resumen legible de la celda: «col: old → new» (design §2.4). El detalle
// completo vive en un <details> nativo — affordance accesible, sin estado y
// SIN botón (ADM-10.3: el DOM no tiene controles de crear/editar/borrar).
export function diffResumen(diff: unknown): string {
  const cambios = diffCambios(diff);
  if (cambios.length === 0) {
    if (diff === null || diff === undefined) return "Sin cambios registrados";
    if (typeof diff === "object" && !Array.isArray(diff)) return "Sin cambios registrados";
    return formatDiffValue(diff);
  }
  const [primero, ...resto] = cambios;
  const base =
    typeof primero.valor === "object" && primero.valor !== null
      ? `${primero.columna}: ${formatDiffValue(primero.valor)}`
      : `${primero.columna}: ${formatDiffValue(primero.valor)}`;
  return resto.length === 0 ? base : `${base} · +${resto.length} más`;
}

// Actor: created_by es un uuid SIN FK (0003:257) — sin join posible, se
// muestra truncado (el título conserva el completo para copiarlo).
function actorCorto(createdBy: string | null): string {
  if (createdBy === null || createdBy === "") return "—";
  return `${createdBy.slice(0, 8)}…`;
}

function fechaLegible(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" });
}

// Cambio individual del detalle: «col: old → new» defensivo (nunca JSON crudo).
function CambioDetalle({ cambio }: { cambio: Cambio }) {
  return (
    <li>
      {cambio.columna}: {formatDiffValue(cambio.valor)}
    </li>
  );
}

const COLUMNAS: DataTableColumn<AuditRow>[] = [
  { key: "fecha", header: "Fecha", render: (row) => fechaLegible(row.created_at) },
  {
    key: "accion",
    header: "Acción",
    render: (row) => (
      <span
        className={`rounded px-2 py-0.5 text-xs font-medium ${ACCION_CLASE[row.action]}`}
      >
        {ACCION_LABEL[row.action]}
      </span>
    ),
  },
  { key: "tabla", header: "Tabla", render: (row) => row.table_name },
  { key: "fila", header: "Fila", render: (row) => row.row_id ?? "—" },
  {
    key: "actor",
    header: "Actor",
    render: (row) =>
      row.created_by === null || row.created_by === "" ? (
        "—"
      ) : (
        <span title={row.created_by}>{actorCorto(row.created_by)}</span>
      ),
  },
  {
    key: "cambios",
    header: "Cambios",
    render: (row) => {
      const cambios = diffCambios(row.diff);
      if (cambios.length === 0) {
        return <span className="text-gray-500">{diffResumen(row.diff)}</span>;
      }
      return (
        <details>
          <summary className="cursor-pointer text-gray-700">
            {diffResumen(row.diff)}
          </summary>
          <ul className="mt-1 list-inside list-disc text-xs text-gray-600">
            {cambios.map((cambio) => (
              <CambioDetalle key={cambio.columna} cambio={cambio} />
            ))}
          </ul>
        </details>
      );
    },
  },
];

export function AuditTable({
  rows,
  loading,
  error,
  hasMore,
  cargandoMas,
  onCargarMas,
}: AuditTableProps) {
  return (
    <DataTable<AuditRow>
      columns={COLUMNAS}
      rows={rows}
      rowKey={(row) => String(row.id)}
      loading={loading}
      error={error}
      emptyTitle="Todavía no hay eventos registrados."
      emptyHint="Los cambios en usuarios, catálogos y operaciones van a aparecer acá."
      footer={
        rows.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {hasMore ? (
              <button
                type="button"
                onClick={onCargarMas}
                disabled={cargandoMas}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                {cargandoMas ? "Cargando…" : "Cargar más"}
              </button>
            ) : (
              <p className="text-sm text-gray-500">No hay más eventos.</p>
            )}
          </div>
        ) : null
      }
    />
  );
}
