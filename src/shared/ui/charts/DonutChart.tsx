import { formatShare } from "./chartMath";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  slices: readonly DonutSlice[];
  centerLabel: string;
  centerValue: string;
  formatValue: (value: number) => string;
  ariaLabel: string;
}

/**
 * Dona con leyenda. La leyenda es HTML (no SVG) para que los nombres largos
 * se lean bien en móvil y para que el gráfico tenga una alternativa textual.
 */
export function DonutChart({
  slices,
  centerLabel,
  centerValue,
  formatValue,
  ariaLabel,
}: DonutChartProps) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    return (
      <p
        role="status"
        className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-6 text-center text-sm text-gray-500"
      >
        Sin ventas registradas en el rango.
      </p>
    );
  }

  const visible = slices.filter((slice) => slice.value > 0);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const gap = visible.length > 1 ? 2.5 : 0;
  let offset = 0;

  const arcs = visible.map((slice) => {
    const fraction = slice.value / total;
    const dash = Math.max(0, fraction * circumference - gap);
    const arc = (
      <circle
        key={slice.key}
        cx="100"
        cy="100"
        r={radius}
        fill="none"
        stroke={slice.color}
        strokeWidth="22"
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={-offset}
        transform="rotate(-90 100 100)"
      />
    );
    offset += fraction * circumference;
    return arc;
  });

  const centerSize = centerValue.length > 9 ? 16 : 20;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <svg role="img" aria-label={ariaLabel} viewBox="0 0 200 200" className="h-40 w-40 shrink-0">
        <circle cx="100" cy="100" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="22" />
        {arcs}
        <text x="100" y="94" textAnchor="middle" fontSize="11" fill="#6b7280">
          {centerLabel}
        </text>
        <text
          x="100"
          y="116"
          textAnchor="middle"
          fontSize={centerSize}
          fontWeight="600"
          fill="#111827"
        >
          {centerValue}
        </text>
      </svg>

      <ul className="w-full space-y-2">
        {slices.map((slice) => (
          <li key={slice.key} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: slice.color }}
            />
            <span className="min-w-0 flex-1 truncate text-gray-700" title={slice.label}>
              {slice.label}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-gray-900">
              {formatValue(slice.value)}
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-gray-500">
              {formatShare(slice.value, total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
