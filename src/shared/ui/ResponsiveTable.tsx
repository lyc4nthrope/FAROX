import type { ReactNode } from "react";

// Tabla que se lee bien en móvil sin scroll horizontal: en escritorio es una
// tabla normal y en pantallas angostas cada fila se apila como tarjeta. La
// columna marcada como `primary` encabeza la tarjeta; el resto muestra su
// rótulo con `data-label` (ver index.css).
export interface ResponsiveTableColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Encabeza la tarjeta en móvil. Por defecto, la primera columna. */
  primary?: boolean;
  className?: string;
}

export interface ResponsiveTableProps<Row> {
  columns: ResponsiveTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Botones por fila; en móvil se muestran al pie de la tarjeta. */
  actions?: (row: Row) => ReactNode;
  /** Rótulo de la columna de acciones (default: «Acciones»). */
  actionsHeader?: string;
  /** Texto para lectores de pantalla que describe la tabla. */
  caption?: string;
}

export function ResponsiveTable<Row>({
  columns,
  rows,
  rowKey,
  actions,
  actionsHeader = "Acciones",
  caption,
}: ResponsiveTableProps<Row>) {
  const primaryKey = columns.find((column) => column.primary)?.key ?? columns[0]?.key;

  return (
    <div className="overflow-x-auto">
      <table className="responsive-table w-full border-collapse text-left text-sm">
        {caption !== undefined && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
            {actions !== undefined && <th>{actionsHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  data-label={column.header}
                  className={[
                    column.key === primaryKey ? "responsive-primary" : "",
                    column.className ?? "",
                  ]
                    .join(" ")
                    .trim()}
                >
                  {column.render(row)}
                </td>
              ))}
              {actions !== undefined && (
                <td data-label={actionsHeader}>
                  <span className="flex flex-wrap gap-1.5">{actions(row)}</span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
