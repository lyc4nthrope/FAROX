// Agregación pura del dashboard para el asistente. Sin APIs de Deno: Vitest
// puede ejercitarla y el handler solo le pasa las filas de get_dashboard.

export type DashboardScope = "network" | "distributor";
export type DashboardPeriod = "today" | "month" | "last_month" | "custom";

export interface DashboardRow {
  day: string;
  distributor_id: number;
  entries_count: number;
  exits_count: number;
  entries_value: number;
  exits_value: number;
}

export interface DashboardTotals {
  value: number;
  count: number;
  label: string;
}

export interface DashboardMonth {
  month: string;
  sales_value: number;
  sales_count: number;
  purchases_value: number;
  purchases_count: number;
}

export interface DashboardDay {
  day: string;
  sales_value: number;
  sales_count: number;
}

export interface DashboardDistributor {
  id: number;
  name: string;
  sales_value: number;
  sales_count: number;
}

export interface DashboardSummary {
  from: string;
  to: string;
  scope: DashboardScope;
  sales: DashboardTotals;
  purchases: DashboardTotals | null;
  by_month: DashboardMonth[];
  top_days: DashboardDay[];
  top_distributors: DashboardDistributor[];
}

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;
const TOP_DAYS = 5;
const TOP_DISTRIBUTORS = 5;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function daysBetween(from: string, to: string): number {
  const start = parseIsoDay(from);
  const end = parseIsoDay(to);
  if (start === null || end === null) return 0;
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resolvePeriod(
  period: DashboardPeriod,
  from?: string,
  to?: string,
  now = new Date(),
): { from: string; to: string } | { error: string } {
  if (period === "today") {
    const day = isoDay(now);
    return { from: day, to: day };
  }
  if (period === "month") {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: isoDay(first), to: isoDay(now) };
  }
  if (period === "last_month") {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { from: isoDay(first), to: isoDay(last) };
  }
  if (period !== "custom") {
    return { error: "Período inválido." };
  }
  if (typeof from !== "string" || typeof to !== "string") {
    return { error: "Para un rango custom usá fechas YYYY-MM-DD." };
  }
  const start = parseIsoDay(from);
  const end = parseIsoDay(to);
  if (start === null || end === null) {
    return { error: "Para un rango custom usá fechas YYYY-MM-DD." };
  }
  if (start > end) {
    return { error: "La fecha inicial debe ser anterior o igual a la final." };
  }
  const days = daysBetween(from, to);
  if (days === 0 || days > MAX_RANGE_DAYS) {
    return { error: `El rango no puede superar los ${MAX_RANGE_DAYS} días.` };
  }
  return { from, to };
}

export function summarizeDashboard(
  rows: readonly DashboardRow[],
  scope: DashboardScope,
  from: string,
  to: string,
  names: Readonly<Record<number, string>> = {},
): DashboardSummary {
  let entriesValue = 0;
  let entriesCount = 0;
  let exitsValue = 0;
  let exitsCount = 0;

  const months = new Map<string, DashboardMonth>();
  const days = new Map<string, DashboardDay>();
  const distributors = new Map<number, { sales_value: number; sales_count: number }>();

  for (const row of rows) {
    entriesValue += row.entries_value;
    entriesCount += row.entries_count;
    exitsValue += row.exits_value;
    exitsCount += row.exits_count;

    const salesValue = scope === "distributor" ? row.entries_value : row.exits_value;
    const salesCount = scope === "distributor" ? row.entries_count : row.exits_count;
    const purchasesValue = scope === "distributor" ? 0 : row.entries_value;
    const purchasesCount = scope === "distributor" ? 0 : row.entries_count;

    const monthKey = row.day.slice(0, 7);
    const month = months.get(monthKey) ?? {
      month: monthKey,
      sales_value: 0,
      sales_count: 0,
      purchases_value: 0,
      purchases_count: 0,
    };
    month.sales_value += salesValue;
    month.sales_count += salesCount;
    month.purchases_value += purchasesValue;
    month.purchases_count += purchasesCount;
    months.set(monthKey, month);

    const day = days.get(row.day) ?? { day: row.day, sales_value: 0, sales_count: 0 };
    day.sales_value += salesValue;
    day.sales_count += salesCount;
    days.set(row.day, day);

    if (scope === "network") {
      const distributor = distributors.get(row.distributor_id) ?? {
        sales_value: 0,
        sales_count: 0,
      };
      distributor.sales_value += row.exits_value;
      distributor.sales_count += row.exits_count;
      distributors.set(row.distributor_id, distributor);
    }
  }

  const sales: DashboardTotals =
    scope === "distributor"
      ? { value: round2(entriesValue), count: entriesCount, label: "ventas a tiendas" }
      : { value: round2(exitsValue), count: exitsCount, label: "salidas" };
  const purchases: DashboardTotals | null =
    scope === "distributor"
      ? null
      : { value: round2(entriesValue), count: entriesCount, label: "entradas" };

  const byMonth = [...months.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((month) => ({
      ...month,
      sales_value: round2(month.sales_value),
      purchases_value: round2(month.purchases_value),
    }));

  const topDays = [...days.values()]
    .map((day) => ({ ...day, sales_value: round2(day.sales_value) }))
    .filter((day) => day.sales_value > 0)
    .sort((a, b) => b.sales_value - a.sales_value || a.day.localeCompare(b.day))
    .slice(0, TOP_DAYS);

  const topDistributors =
    scope === "network"
      ? [...distributors.entries()]
          .map(([id, distributor]) => ({
            id,
            name: names[id] ?? `#${id}`,
            sales_value: round2(distributor.sales_value),
            sales_count: distributor.sales_count,
          }))
          .filter((distributor) => distributor.sales_value > 0)
          .sort(
            (a, b) => b.sales_value - a.sales_value || a.name.localeCompare(b.name),
          )
          .slice(0, TOP_DISTRIBUTORS)
      : [];

  return {
    from,
    to,
    scope,
    sales,
    purchases,
    by_month: byMonth,
    top_days: topDays,
    top_distributors: topDistributors,
  };
}
