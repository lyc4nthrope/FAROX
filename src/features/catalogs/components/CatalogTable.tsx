import {
  DataTable,
  type DataTableAction,
  type DataTableColumn,
} from "../../../shared/ui";
import type { CatalogDefinition } from "../definitions";
import type { CatalogRow } from "../types";

// Presentacional pura (D1) · sdd/admin-console T-C4: tabla genérica del
// motor de catálogos sobre la primitiva DataTable (T-B2, D-M1). TODO lo
// específico (columnas, deleteMode) viene de la definition — acá no hay
// lógica por tabla.
export interface CatalogTableProps {
  definition: CatalogDefinition;
  rows: CatalogRow[];
  loading: boolean;
  // SIEMPRE mapeado por mapError() vía useList (HARD-1): jamás texto crudo.
  error: string | null;
  onEdit: (row: CatalogRow) => void;
  /** HARD delete (unit/store_types, categorías) o paso 2 del two-step (brands). */
  onDelete: (row: CatalogRow) => void;
  /** Paso 1 del two-step de brands (is_active = false, policy 0006:95-97). */
  onDeactivate: (row: CatalogRow) => void;
}

// Valor de la celda por defecto: String(valor ?? "—"). display() de la
// column config (p. ej. Estado de brands) lo reemplaza.
function valorPorDefecto(row: CatalogRow, key: string): string {
  const raw = (row as unknown as Record<string, unknown>)[key];
  if (raw === null || raw === undefined || raw === "") return "—";
  return String(raw);
}

export function CatalogTable({
  definition,
  rows,
  loading,
  error,
  onEdit,
  onDelete,
  onDeactivate,
}: CatalogTableProps) {
  const columns: DataTableColumn<CatalogRow>[] = definition.columns.map(
    (column) => ({
      key: column.key,
      header: column.header,
      render: (row) =>
        column.display === undefined
          ? valorPorDefecto(row, column.key)
          : column.display(row),
    }),
  );

  // Acciones por deleteMode (ADM-9.2): hard ⇒ «Eliminar» en toda fila;
  // soft-two-step (brands) ⇒ «Desactivar» SOLO sobre filas activas y
  // «Eliminar» SOLO sobre filas ya desactivadas (0006:95-97).
  const acciones: DataTableAction<CatalogRow>[] = [
    { key: "editar", label: "Editar", onClick: onEdit },
    ...(definition.deleteMode === "soft-two-step"
      ? [
          {
            key: "desactivar",
            label: "Desactivar",
            visible: (row: CatalogRow) => row.is_active,
            onClick: onDeactivate,
          },
        ]
      : []),
    {
      key: "eliminar",
      label: "Eliminar",
      visible:
        definition.deleteMode === "soft-two-step"
          ? (row: CatalogRow) => !row.is_active
          : undefined,
      onClick: onDelete,
    },
  ];

  return (
    <DataTable<CatalogRow>
      columns={columns}
      rows={rows}
      rowKey={(row) => String(row.id)}
      loading={loading}
      error={error}
      emptyTitle={definition.emptyTitle}
      emptyHint="Creá el primero desde el formulario de arriba."
      actions={acciones}
    />
  );
}
