import { formatCOP, formatQty } from "../../shared/lib/format";

/**
 * Datos del dashboard INT-01. La RPC `get_dashboard` entrega un agregado por
 * día y distribuidor: conteos y valores de entradas/salidas. Este módulo los
 * convierte en series para los gráficos y mantiene una regla de negocio clave:
 *
 * - admin/operador: la venta de la tienda son las SALIDAS (stock que sale).
 * - distribuidor: su venta a la tienda se registra como ENTRADA (la entrega
 *   que confirma el pedido); por eso "ventas" usa `entries_*` en su alcance.
 */
export interface DashboardRow {
  day: string;
  distributor_id: number;
  entries_count: number;
  exits_count: number;
  entries_value: number;
  exits_value: number;
}

export interface DailyPoint {
  day: string;
  entriesCount: number;
  exitsCount: number;
  entriesValue: number;
  exitsValue: number;
}

export type DashboardMetric = "value" | "count";
export type DashboardScope = "distributor" | "network";

export interface DistributorTotals {
  id: number;
  label: string;
  entriesCount: number;
  exitsCount: number;
  entriesValue: number;
  exitsValue: number;
}

export interface SalesBucket {
  key: string;
  label: string;
  value: number;
}

const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

function parseDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(year, month - 1, date);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== date
  ) {
    return null;
  }
  return parsed;
}

function toIsoDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Días inclusivos del rango; 0 si el rango es inválido o está invertido. */
export function daysBetween(from: string, to: string): number {
  const start = parseDay(from);
  const end = parseDay(to);
  if (start === null || end === null || start > end) return 0;
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / DAY_MS) + 1;
}

function emptyPoint(day: string): DailyPoint {
  return {
    day,
    entriesCount: 0,
    exitsCount: 0,
    entriesValue: 0,
    exitsValue: 0,
  };
}

/**
 * Agrega las filas por día y rellena con ceros los días sin movimiento, para
 * que la línea no una dos fechas lejanas como si fueran consecutivas.
 */
export function buildDailyPoints(
  rows: readonly DashboardRow[],
  from: string,
  to: string,
): DailyPoint[] {
  const totalDays = daysBetween(from, to);
  if (totalDays === 0 || totalDays > MAX_RANGE_DAYS) return [];

  const byDay = new Map<string, DailyPoint>();
  for (const row of rows) {
    const current = byDay.get(row.day) ?? emptyPoint(row.day);
    current.entriesCount += row.entries_count;
    current.exitsCount += row.exits_count;
    current.entriesValue += row.entries_value;
    current.exitsValue += row.exits_value;
    byDay.set(row.day, current);
  }

  const cursor = parseDay(from);
  if (cursor === null) return [];
  cursor.setHours(12, 0, 0, 0);

  const points: DailyPoint[] = [];
  for (let index = 0; index < totalDays; index += 1) {
    const day = toIsoDay(cursor);
    points.push(byDay.get(day) ?? emptyPoint(day));
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

export function totalPoint(points: readonly DailyPoint[]): DailyPoint {
  return points.reduce(
    (total, point) => ({
      day: "total",
      entriesCount: total.entriesCount + point.entriesCount,
      exitsCount: total.exitsCount + point.exitsCount,
      entriesValue: total.entriesValue + point.entriesValue,
      exitsValue: total.exitsValue + point.exitsValue,
    }),
    emptyPoint("total"),
  );
}

/** Valor de ventas según el alcance. */
export function salesOf(point: DailyPoint, scope: DashboardScope, metric: DashboardMetric): number {
  if (scope === "distributor") {
    return metric === "value" ? point.entriesValue : point.entriesCount;
  }
  return metric === "value" ? point.exitsValue : point.exitsCount;
}

/**
 * Compras/abastecimiento: para la red son las entradas de stock. El
 * distribuidor no tiene una serie de compras equivalente en este agregado.
 */
export function purchasesOf(
  point: DailyPoint,
  scope: DashboardScope,
  metric: DashboardMetric,
): number | null {
  if (scope === "distributor") return null;
  return metric === "value" ? point.entriesValue : point.entriesCount;
}

export function distributorTotals(
  rows: readonly DashboardRow[],
  names: Readonly<Record<number, string>>,
): DistributorTotals[] {
  const byId = new Map<number, DistributorTotals>();
  for (const row of rows) {
    const current = byId.get(row.distributor_id) ?? {
      id: row.distributor_id,
      label:
        row.distributor_id === 0
          ? "Sin distribuidor (manual)"
          : (names[row.distributor_id] ?? `#${row.distributor_id}`),
      entriesCount: 0,
      exitsCount: 0,
      entriesValue: 0,
      exitsValue: 0,
    };
    current.entriesCount += row.entries_count;
    current.exitsCount += row.exits_count;
    current.entriesValue += row.entries_value;
    current.exitsValue += row.exits_value;
    byId.set(row.distributor_id, current);
  }

  return [...byId.values()].sort(
    (a, b) =>
      b.exitsValue - a.exitsValue ||
      b.entriesValue - a.entriesValue ||
      a.label.localeCompare(b.label, "es"),
  );
}

/** Deja los primeros `limit` y agrupa el resto en «Otros (N)». */
export function topDistributors(
  items: readonly DistributorTotals[],
  limit: number,
  includeOthers: boolean,
): DistributorTotals[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  if (items.length <= safeLimit) return [...items];
  if (!includeOthers) return items.slice(0, safeLimit);

  const top = items.slice(0, Math.max(0, safeLimit - 1));
  const rest = items.slice(Math.max(0, safeLimit - 1));
  const other = rest.reduce<DistributorTotals>(
    (total, item) => ({
      ...total,
      entriesCount: total.entriesCount + item.entriesCount,
      exitsCount: total.exitsCount + item.exitsCount,
      entriesValue: total.entriesValue + item.entriesValue,
      exitsValue: total.exitsValue + item.exitsValue,
    }),
    {
      id: -1,
      label: `Otros (${rest.length})`,
      entriesCount: 0,
      exitsCount: 0,
      entriesValue: 0,
      exitsValue: 0,
    },
  );
  return [...top, other];
}

export function salesByWeekday(
  points: readonly DailyPoint[],
  scope: DashboardScope,
  metric: DashboardMetric,
): SalesBucket[] {
  const totals = new Map<number, number>();
  for (const point of points) {
    const date = parseDay(point.day);
    if (date === null) continue;
    const weekday = date.getDay();
    totals.set(weekday, (totals.get(weekday) ?? 0) + salesOf(point, scope, metric));
  }

  return WEEKDAY_ORDER.map((weekday) => ({
    key: String(weekday),
    label: WEEKDAY_LABELS[weekday] ?? "",
    value: totals.get(weekday) ?? 0,
  }));
}

/** Mejores días del rango por ventas (los días sin ventas no se listan). */
export function topSalesDays(
  points: readonly DailyPoint[],
  scope: DashboardScope,
  metric: DashboardMetric,
  limit = 7,
): SalesBucket[] {
  return points
    .map((point) => ({
      key: point.day,
      label: formatShortDay(point.day),
      value: salesOf(point, scope, metric),
    }))
    .filter((bucket) => bucket.value > 0)
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, limit));
}

/** Promedio móvil con ventana parcial al inicio del rango. */
export function movingAverage(values: readonly number[], window = 7): number[] {
  const size = Math.max(1, Math.floor(window));
  const result: number[] = [];
  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index] ?? 0;
    if (index >= size) sum -= values[index - size] ?? 0;
    result.push(sum / Math.min(index + 1, size));
  }
  return result;
}

export function formatDay(day: string): string {
  const date = parseDay(day);
  if (date === null) return day;
  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function formatShortDay(day: string): string {
  const date = parseDay(day);
  if (date === null) return day;
  return date.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

/** 1.2 M, 850 k, 12. Sin decimales innecesarios. */
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  const decimal = (fraction: number) =>
    fraction.toLocaleString("es-CO", { maximumFractionDigits: 1 });

  // «M» es millón. Para miles de millones se prefiere «1.200 M» antes que
  // «1,2 MM», que en español se lee de forma ambigua.
  if (abs >= 1_000_000) return `${decimal(value / 1_000_000)} M`;
  if (abs >= 1_000) return `${decimal(value / 1_000)} k`;
  return decimal(value);
}

export function formatMetricValue(value: number, metric: DashboardMetric): string {
  return metric === "value" ? formatCOP(value) : formatQty(Math.round(value));
}

export function formatMetricAxis(value: number, metric: DashboardMetric): string {
  const compact = formatCompactNumber(value);
  return metric === "value" ? `$${compact}` : compact;
}
