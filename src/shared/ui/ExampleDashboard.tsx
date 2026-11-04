export interface ExampleDashboardStat {
  label: string;
  value: string;
  hint: string;
}

export interface ExampleDashboardProps {
  stats: readonly [ExampleDashboardStat, ExampleDashboardStat];
  stops: readonly string[];
  /** Rótulo superior; por defecto deja explícito que es un ejemplo. */
  eyebrow?: string;
  /** Píldora de la esquina superior derecha. */
  badge?: string;
  /** Texto cuando todavía no hay paradas reales que listar. */
  emptyStopsText?: string;
  /**
   * "compact" (por defecto): tarjeta angosta para landing, inicio y previews.
   * "wide": ocupa el ancho disponible y reparte stats y paradas en columnas,
   * para que acompañe el layout de una pantalla completa (por ejemplo /mi-ruta).
   */
  layout?: "compact" | "wide";
}

// Panel compartido por la landing, el inicio del distribuidor y su ruta real.
// Sin props de texto muestra una “Vista de ejemplo” explícita; con datos
// reales el llamador cambia el rótulo (por ejemplo “Tu día”).
export function ExampleDashboard({
  stats,
  stops,
  eyebrow = "Vista de ejemplo",
  badge = "Hoy",
  emptyStopsText,
  layout = "compact",
}: ExampleDashboardProps) {
  const wide = layout === "wide";
  return (
    <div className="relative rounded-2xl border border-gray-200 bg-white p-4 shadow-xl shadow-gray-200/60">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
          {eyebrow}
        </span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          {badge}
        </span>
      </div>
      <div className={wide ? "mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : ""}>
        <div className={`grid grid-cols-2 gap-3 ${wide ? "" : "mt-4"}`}>
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className={
                index === 0
                  ? "rounded-xl bg-gray-900 p-3 text-white"
                  : "rounded-xl border border-gray-200 p-3"
              }
            >
              <p className={`text-[11px] ${index === 0 ? "text-gray-400" : "text-gray-500"}`}>
                {stat.label}
              </p>
              <p className="mt-1 text-2xl font-semibold">{stat.value}</p>
              <p className={`text-[11px] ${index === 0 ? "text-gray-400" : "text-gray-500"}`}>
                {stat.hint}
              </p>
            </div>
          ))}
        </div>
        <div className={`rounded-xl border border-gray-200 p-3 ${wide ? "mt-3 lg:mt-0" : "mt-3"}`}>
          <p className="text-[11px] font-medium text-gray-500">Ruta de hoy</p>
          {stops.length === 0 && emptyStopsText !== undefined && (
            <p className="mt-2 text-xs text-gray-500">{emptyStopsText}</p>
          )}
          <ul className="mt-2 space-y-2">
            {stops.map((stop, index) => (
              <li key={stop} className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-600">
                  {index + 1}
                </span>
                <span className="flex-1 text-xs text-gray-700">{stop}</span>
                <span className="h-1.5 w-10 rounded-full bg-gray-100" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
