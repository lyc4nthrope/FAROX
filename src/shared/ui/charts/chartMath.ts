// Helpers puros de los gráficos. Sin React y sin dependencias: el mismo
// cálculo se usa en la pantalla y se puede probar por separado.

export interface ChartScale {
  max: number;
  ticks: number[];
}

/** Escala "bonita" (0, 1, 2, 5 × 10^n) para que el eje no muestre valores raros. */
export function niceScale(maxValue: number, tickCount = 4): ChartScale {
  const safeMax = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
  const rough = safeMax / Math.max(1, tickCount);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const max = Math.ceil(safeMax / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 1000; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return { max, ticks };
}

/** Índices de etiquetas del eje X, sin amontonar texto en rangos largos. */
export function pickLabelIndices(count: number, maxLabels = 6): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);
  const indices = new Set<number>();
  for (let index = 0; index < maxLabels; index += 1) {
    indices.add(Math.round((index * (count - 1)) / (maxLabels - 1)));
  }
  return [...indices].sort((a, b) => a - b);
}

/** Path SVG de una línea. */
export function linePath(
  values: readonly number[],
  xAt: (index: number) => number,
  yAt: (value: number) => number,
): string {
  return values
    .map((value, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`;
    })
    .join(" ");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Porcentaje legible en es-CO: 1 de 3 → "33,3%". */
export function formatShare(value: number, total: number): string {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) return "0%";
  return `${((value / total) * 100).toLocaleString("es-CO", {
    maximumFractionDigits: 1,
  })}%`;
}
