import { useId, useState } from "react";

import { clamp, linePath, niceScale, pickLabelIndices } from "./chartMath";
import { useElementWidth } from "./useElementWidth";

export interface LineChartSeries {
  key: string;
  label: string;
  color: string;
  values: readonly number[];
  /** Línea de referencia (por ejemplo, un promedio móvil). */
  dashed?: boolean;
}

export interface LineChartProps {
  labels: readonly string[];
  series: readonly LineChartSeries[];
  formatValue: (value: number) => string;
  formatAxis: (value: number) => string;
  ariaLabel: string;
  height?: number;
}

const GRID = "#e5e7eb";
const AXIS_TEXT = "#6b7280";

/**
 * Gráfico de líneas con tooltip por puntero. El SVG se dibuja con el ancho
 * medido del contenedor para que el texto no se encoja en pantallas angostas.
 */
export function LineChart({
  labels,
  series,
  formatValue,
  formatAxis,
  ariaLabel,
  height = 240,
}: LineChartProps) {
  const { ref, width } = useElementWidth();
  const gradientId = useId().replace(/:/g, "");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const hasData = labels.length > 0 && series.some((item) => item.values.length > 0);
  if (!hasData) {
    return (
      <p
        role="status"
        className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 p-6 text-center text-sm text-gray-500"
      >
        Sin datos para graficar en el rango.
      </p>
    );
  }

  const safeWidth = Math.max(280, width);
  const marginLeft = safeWidth < 380 ? 46 : 56;
  const marginRight = 12;
  const marginTop = 14;
  const marginBottom = 28;
  const plotWidth = Math.max(1, safeWidth - marginLeft - marginRight);
  const plotHeight = Math.max(1, height - marginTop - marginBottom);
  const maxValue = Math.max(...series.flatMap((item) => [...item.values]));
  const scale = niceScale(maxValue, 4);

  const xAt = (index: number) =>
    marginLeft +
    (labels.length === 1 ? plotWidth / 2 : (index / (labels.length - 1)) * plotWidth);
  const yAt = (value: number) =>
    marginTop + plotHeight - (value / scale.max) * plotHeight;
  const labelIndices = pickLabelIndices(labels.length, 6);

  const primary = series[0];
  const primaryValues = primary?.values ?? [];
  const areaPath =
    primaryValues.length > 0
      ? `${linePath(primaryValues, xAt, yAt)} L${xAt(primaryValues.length - 1).toFixed(2)},${(
          marginTop + plotHeight
        ).toFixed(2)} L${xAt(0).toFixed(2)},${(marginTop + plotHeight).toFixed(2)} Z`
      : "";

  // Si el rango cambia mientras el puntero estaba activo, el índice viejo
  // puede quedar fuera de las etiquetas nuevas.
  const safeActiveIndex =
    activeIndex !== null && activeIndex < labels.length ? activeIndex : null;
  const activeRow =
    safeActiveIndex === null
      ? null
      : {
          index: safeActiveIndex,
          x: xAt(safeActiveIndex),
          label: labels[safeActiveIndex] ?? "",
          primaryValue: primaryValues[safeActiveIndex] ?? 0,
        };

  const tooltipWidth = 158;
  const tooltipHeight = 22 + series.length * 17;
  const tooltipX =
    activeRow === null
      ? 0
      : clamp(
          activeRow.x - tooltipWidth / 2,
          marginLeft,
          safeWidth - marginRight - tooltipWidth,
        );
  const tooltipY =
    activeRow === null
      ? 0
      : clamp(
          yAt(activeRow.primaryValue) - tooltipHeight - 10,
          marginTop,
          marginTop + plotHeight - tooltipHeight,
        );

  function selectFromPointer(event: React.PointerEvent<SVGRectElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relative = clamp(event.clientX - rect.left, 0, rect.width);
    const index =
      labels.length === 1
        ? 0
        : Math.round((relative / rect.width) * (labels.length - 1));
    setActiveIndex(clamp(index, 0, labels.length - 1));
  }

  return (
    <div ref={ref} className="w-full">
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
      <svg
        role="img"
        aria-label={ariaLabel}
        width={safeWidth}
        height={height}
        viewBox={`0 0 ${safeWidth} ${height}`}
        className="block max-w-full"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={primary?.color ?? "#059669"} stopOpacity="0.22" />
            <stop offset="100%" stopColor={primary?.color ?? "#059669"} stopOpacity="0" />
          </linearGradient>
        </defs>

        {scale.ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={marginLeft}
              x2={marginLeft + plotWidth}
              y1={yAt(tick)}
              y2={yAt(tick)}
              stroke={GRID}
              strokeDasharray={tick === 0 ? undefined : "3 4"}
            />
            <text
              x={marginLeft - 8}
              y={yAt(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill={AXIS_TEXT}
            >
              {formatAxis(tick)}
            </text>
          </g>
        ))}

        {areaPath !== "" && <path d={areaPath} fill={`url(#${gradientId})`} />}

        {series.map((item) => (
          <path
            key={item.key}
            d={linePath(item.values, xAt, yAt)}
            fill="none"
            stroke={item.color}
            strokeWidth={item.dashed ? 1.8 : 2.25}
            strokeDasharray={item.dashed ? "5 4" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {labels.length <= 31 &&
          primaryValues.map((value, index) => (
            <circle
              key={`${labels[index]}-${index}`}
              cx={xAt(index)}
              cy={yAt(value)}
              r={3}
              fill={primary?.color ?? "#059669"}
              stroke="#ffffff"
              strokeWidth={1.5}
            >
              <title>{`${labels[index] ?? ""}: ${formatValue(value)}`}</title>
            </circle>
          ))}

        {labelIndices.map((index) => (
          <text
            key={`${labels[index]}-${index}`}
            x={xAt(index)}
            y={height - 6}
            textAnchor={
              labels.length === 1
                ? "middle"
                : index === 0
                  ? "start"
                  : index === labels.length - 1
                    ? "end"
                    : "middle"
            }
            fontSize="10"
            fill={AXIS_TEXT}
          >
            {labels[index]}
          </text>
        ))}

        <rect
          x={marginLeft}
          y={marginTop}
          width={plotWidth}
          height={plotHeight}
          fill="transparent"
          pointerEvents="all"
          style={{ touchAction: "pan-y" }}
          onPointerDown={selectFromPointer}
          onPointerMove={selectFromPointer}
          onPointerLeave={() => setActiveIndex(null)}
        />

        {activeRow !== null && (
          <g pointerEvents="none">
            <line
              x1={activeRow.x}
              x2={activeRow.x}
              y1={marginTop}
              y2={marginTop + plotHeight}
              stroke="#9ca3af"
              strokeDasharray="3 3"
            />
            <circle
              cx={activeRow.x}
              cy={yAt(activeRow.primaryValue)}
              r={4}
              fill={primary?.color ?? "#059669"}
              stroke="#ffffff"
              strokeWidth={2}
            />
            <rect
              x={tooltipX}
              y={tooltipY}
              width={tooltipWidth}
              height={tooltipHeight}
              rx={8}
              fill="#111827"
              opacity="0.96"
            />
            <text
              x={tooltipX + 10}
              y={tooltipY + 15}
              fill="#9ca3af"
              fontSize="10"
            >
              {activeRow.label}
            </text>
            {series.map((item, index) => {
              const value = item.values[activeRow.index] ?? 0;
              const rowY = tooltipY + 32 + index * 17;
              return (
                <g key={item.key}>
                  <rect
                    x={tooltipX + 10}
                    y={rowY - 7}
                    width={8}
                    height={8}
                    rx={2}
                    fill={item.color}
                  />
                  <text
                    x={tooltipX + 23}
                    y={rowY}
                    fill="#e5e7eb"
                    fontSize="10"
                  >
                    {item.label}
                  </text>
                  <text
                    x={tooltipX + tooltipWidth - 10}
                    y={rowY}
                    fill="#ffffff"
                    fontSize="10"
                    fontWeight="600"
                    textAnchor="end"
                  >
                    {formatValue(value)}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
