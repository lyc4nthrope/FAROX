export interface BarChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface BarChartItem {
  key: string;
  label: string;
  /** Un valor por serie, en el mismo orden de `series`. */
  values: readonly number[];
}

export interface BarChartProps {
  items: readonly BarChartItem[];
  series: readonly BarChartSeries[];
  formatValue: (value: number) => string;
  ariaLabel: string;
  emptyText?: string;
}

/**
 * Barras horizontales agrupadas. Se implementan con HTML (no SVG) para que
 * los rótulos largos de distribuidor se trunquen con `title` y para que la
 * comparación siga siendo legible en móvil.
 */
export function BarChart({
  items,
  series,
  formatValue,
  ariaLabel,
  emptyText = "Sin datos en el rango.",
}: BarChartProps) {
  const total = items.reduce(
    (sum, item) => sum + item.values.reduce((itemSum, value) => itemSum + value, 0),
    0,
  );

  if (items.length === 0 || total <= 0) {
    return (
      <p
        role="status"
        className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-6 text-center text-sm text-gray-500"
      >
        {emptyText}
      </p>
    );
  }

  const max = Math.max(1, ...items.flatMap((item) => [...item.values]));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>

      <div className="mb-1 flex justify-between text-[10px] text-gray-400">
        <span>0</span>
        <span>{formatValue(max)}</span>
      </div>

      <ul aria-label={ariaLabel} className="space-y-4">
        {items.map((item) => (
          <li key={item.key} className="space-y-1.5">
            <p className="truncate text-xs font-medium text-gray-700" title={item.label}>
              {item.label}
            </p>
            {series.map((serie, index) => {
              const value = item.values[index] ?? 0;
              const percent = Math.min(100, Math.max(0, (value / max) * 100));
              return (
                <div key={serie.key} className="flex items-center gap-2">
                  <div
                    aria-hidden="true"
                    className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100"
                  >
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${percent}%`, backgroundColor: serie.color }}
                    />
                  </div>
                  <span className="w-20 shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-gray-600">
                    {formatValue(value)}
                  </span>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
