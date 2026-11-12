import { useEffect, useState } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { formatCOP, formatQty } from "../../../shared/lib/format";
import { supabase } from "../../../shared/lib/supabase/client";
import { Box, Field, Status, inputClass } from "../../../shared/ui/Box";
import {
  BarChart,
  DonutChart,
  EmptyState,
  ExampleDashboard,
  LineChart,
  PremiumBadge,
  PremiumLock,
  ResponsiveTable,
} from "../../../shared/ui";
import type {
  BarChartItem,
  BarChartSeries,
  DonutSlice,
  LineChartSeries,
  ResponsiveTableColumn,
} from "../../../shared/ui";
import {
  buildDailyPoints,
  daysBetween,
  distributorTotals,
  formatDay,
  formatMetricAxis,
  formatMetricValue,
  formatShortDay,
  movingAverage,
  purchasesOf,
  salesByWeekday,
  salesOf,
  topDistributors,
  topSalesDays,
  totalPoint,
} from "../dashboardData";
import type { DashboardMetric, DashboardRow } from "../dashboardData";

const RANGE_PRESETS = [
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
  { label: "90 días", days: 90 },
] as const;

const MAX_RANGE_DAYS = 366;
const REALTIME_RELOAD_DEBOUNCE_MS = 500;

// Colores del sistema: las ventas conservan el verde que ya usaba «Salidas»
// y las compras el gris oscuro de «Entradas». La dona usa una paleta corta
// para distinguir categorías sin convertir el dashboard en un semáforo.
const SALES_COLOR = "#059669";
const PURCHASES_COLOR = "#111827";
const AVERAGE_COLOR = "#64748b";
const CATEGORY_COLORS = [
  "#059669",
  "#0ea5e9",
  "#f59e0b",
  "#8b5cf6",
  "#f43f5e",
  "#64748b",
  "#14b8a6",
];
const ZERO_SLICE_COLOR = "#d1d5db";

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString("en-CA");
}

async function fetchDashboard(from: string, to: string) {
  const { data, error } = await supabase.rpc("get_dashboard", { p_from: from, p_to: to });
  const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    day: String(row.day),
    distributor_id: Number(row.distributor_id),
    entries_count: Number(row.entries_count),
    exits_count: Number(row.exits_count),
    entries_value: Number(row.entries_value),
    exits_value: Number(row.exits_value),
  }));
  return { data: rows, error };
}

async function fetchDistributorNames() {
  const { data, error } = await supabase.from("distributors").select("id,name").limit(500);
  const map: Record<number, string> = {};
  for (const distributor of (data ?? []) as { id: number; name: string }[]) {
    map[distributor.id] = distributor.name;
  }
  return { data: map, error };
}

/**
 * /dashboard — INT-01: entradas y salidas por día y por distribuidor.
 * Los gráficos son una lectura visual del mismo agregado; el detalle exacto
 * sigue disponible en la tabla. Conteos y valores nunca se suman entre sí.
 */
export function DashboardPage() {
  const { premium, role } = useAuth();
  const esDistribuidor = role === "distribuidor";
  const scope = esDistribuidor ? "distributor" : "network";
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [metric, setMetric] = useState<DashboardMetric>("value");

  const rangeDays = daysBetween(from, to);
  const invertedRange = from > to;
  const rangeError = invertedRange
    ? "La fecha inicial debe ser anterior o igual a la final."
    : rangeDays > MAX_RANGE_DAYS
      ? `El rango no puede superar los ${MAX_RANGE_DAYS} días.`
      : rangeDays === 0
        ? "Elegí un rango de fechas válido."
        : null;
  const rangeOk = rangeError === null;

  const rows = useLoad(
    () =>
      premium && rangeOk
        ? fetchDashboard(from, to)
        : Promise.resolve({ data: [] as DashboardRow[], error: null }),
    [from, to, premium, rangeOk],
  );
  const names = useLoad(
    () =>
      !premium || esDistribuidor
        ? Promise.resolve({ data: {} as Record<number, string>, error: null })
        : fetchDistributorNames(),
    [esDistribuidor, premium],
  );

  const reload = rows.reload;

  // dashboard_daily ya está publicada en Realtime (migración 0007) y 0048 deja
  // un solo upsert por ticket: un evento = un refresco. El debounce agrupa
  // ráfagas y el foco/visibilidad cubren eventos perdidos en segundo plano.
  useEffect(() => {
    if (!premium) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        reload();
      }, REALTIME_RELOAD_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`dashboard-daily-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "dashboard_daily" },
        scheduleReload,
      )
      .subscribe();

    const onFocus = () => scheduleReload();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleReload();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [premium, reload]);

  if (!premium) {
    return (
      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
          Analítica
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          {esDistribuidor
            ? "El pulso de tu operación: cuánto vendés y cómo se mueve tu negocio en el período."
            : "El pulso de tu operación: cuánto se vende, cómo se mueve cada distribuidor y la tendencia del período."}
        </p>
        <PremiumLock
          title="Dashboard analítico"
          benefits={
            esDistribuidor
              ? [
                  "Gráfico de líneas con tus ventas y su promedio semanal.",
                  "Barras con tus mejores días y participación por día de la semana.",
                  "Totales y valores en pesos del rango que elijas.",
                ]
              : [
                  "Gráfico de líneas con ventas y compras día por día.",
                  "Participación de ventas y comparativa por distribuidor.",
                  "Totales y valores en pesos del rango que elijas.",
                ]
          }
          preview={
            <ExampleDashboard
              stats={[
                { label: "Ventas del rango", value: "$1.240.000", hint: "94 salidas" },
                { label: "Compras del rango", value: "$860.000", hint: "128 entradas" },
              ]}
              stops={["Sin distribuidor (manual)", "Distribuidora Norte", "Distribuidora Sur"]}
            />
          }
        />
      </section>
    );
  }

  const data = rows.data ?? [];
  const dailyPoints = buildDailyPoints(data, from, to);
  const totals = totalPoint(dailyPoints);
  const daysWithMovement = dailyPoints.filter(
    (point) => point.entriesCount + point.exitsCount > 0,
  ).length;
  const distributorRows = distributorTotals(data, names.data ?? {});
  const distributorSales = (item: (typeof distributorRows)[number]) =>
    metric === "value" ? item.exitsValue : item.exitsCount;

  const donutDistributors = topDistributors(
    distributorRows.filter((item) => distributorSales(item) > 0),
    5,
    true,
  );
  const barDistributors = topDistributors(distributorRows, 6, false);
  const weekdaySales = salesByWeekday(dailyPoints, scope, metric);
  const topDays = topSalesDays(dailyPoints, scope, metric, 7);

  const dailySales = dailyPoints.map((point) => salesOf(point, scope, metric));
  const dailyPurchases = dailyPoints.map(
    (point) => purchasesOf(point, scope, metric) ?? 0,
  );
  const averageSales = movingAverage(dailySales, 7);
  const lineLabels = dailyPoints.map((point) => formatShortDay(point.day));

  const lineSeries: LineChartSeries[] = esDistribuidor
    ? [
        { key: "sales", label: "Ventas", color: SALES_COLOR, values: dailySales },
        {
          key: "average",
          label: "Promedio 7 días",
          color: AVERAGE_COLOR,
          values: averageSales,
          dashed: true,
        },
      ]
    : [
        { key: "sales", label: "Ventas", color: SALES_COLOR, values: dailySales },
        {
          key: "purchases",
          label: "Compras",
          color: PURCHASES_COLOR,
          values: dailyPurchases,
        },
      ];

  const donutSlices: DonutSlice[] = esDistribuidor
    ? weekdaySales.map((bucket, index) => ({
        key: bucket.key,
        label: bucket.label,
        value: bucket.value,
        color:
          bucket.value > 0
            ? (CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? ZERO_SLICE_COLOR)
            : ZERO_SLICE_COLOR,
      }))
    : donutDistributors.map((item, index) => ({
        key: String(item.id),
        label: item.label,
        value: distributorSales(item),
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length] ?? ZERO_SLICE_COLOR,
      }));

  const barItems: BarChartItem[] = esDistribuidor
    ? topDays.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        values: [bucket.value],
      }))
    : barDistributors.map((item) => ({
        key: String(item.id),
        label: item.label,
        values: [
          metric === "value" ? item.entriesValue : item.entriesCount,
          metric === "value" ? item.exitsValue : item.exitsCount,
        ],
      }));

  const barSeries: BarChartSeries[] = esDistribuidor
    ? [{ key: "sales", label: "Ventas", color: SALES_COLOR }]
    : [
        { key: "purchases", label: "Compras", color: PURCHASES_COLOR },
        { key: "sales", label: "Ventas", color: SALES_COLOR },
      ];

  const salesTotal = salesOf(totals, scope, metric);
  const count = (value: number) => formatQty(Math.round(value));
  const money = (value: number) => formatCOP(value);
  const label = (id: number) =>
    id === 0 ? "Sin distribuidor (manual)" : (names.data?.[id] ?? `#${id}`);

  const kpis: { label: string; value: string; hint: string; tone: "dark" | "light" }[] =
    esDistribuidor
      ? [
          {
            label: "Ventas",
            value: rows.loading ? "—" : money(totals.entriesValue),
            hint: `${count(totals.entriesCount)} ventas a tiendas`,
            tone: "dark",
          },
          {
            label: "Promedio diario",
            value: rows.loading
              ? "—"
              : money(totals.entriesValue / Math.max(1, dailyPoints.length)),
            hint: "Sobre los días del rango",
            tone: "light",
          },
          {
            label: "Movimientos",
            value: rows.loading ? "—" : count(totals.entriesCount + totals.exitsCount),
            hint: "Ventas y salidas juntas",
            tone: "light",
          },
          {
            label: "Días",
            value: rows.loading ? "—" : String(daysWithMovement),
            hint: "Con movimiento en el rango",
            tone: "light",
          },
        ]
      : [
          {
            label: "Ventas",
            value: rows.loading ? "—" : money(totals.exitsValue),
            hint: `${count(totals.exitsCount)} salidas`,
            tone: "dark",
          },
          {
            label: "Compras",
            value: rows.loading ? "—" : money(totals.entriesValue),
            hint: `${count(totals.entriesCount)} entradas`,
            tone: "light",
          },
          {
            label: "Movimientos",
            value: rows.loading ? "—" : count(totals.entriesCount + totals.exitsCount),
            hint: "Entradas y salidas juntas",
            tone: "light",
          },
          {
            label: "Distribuidores",
            value: rows.loading ? "—" : String(distributorRows.length),
            hint: "Con movimiento en el rango",
            tone: "light",
          },
        ];

  const dayColumns: ResponsiveTableColumn<DashboardRow>[] = [
    {
      key: "day",
      header: "Día",
      primary: true,
      className: "whitespace-nowrap",
      render: (row) => formatDay(row.day),
    },
  ];
  if (!esDistribuidor) {
    dayColumns.push({
      key: "distributor",
      header: "Distribuidor",
      render: (row) => label(row.distributor_id),
    });
  }
  dayColumns.push(
    {
      key: "entries",
      header: esDistribuidor ? "Ventas" : "Entradas",
      render: (row) => formatQty(row.entries_count),
    },
    { key: "exits", header: "Salidas", render: (row) => formatQty(row.exits_count) },
    {
      key: "sales",
      header: esDistribuidor ? "Valor ventas" : "Ventas",
      className: "whitespace-nowrap",
      render: (row) => formatCOP(esDistribuidor ? row.entries_value : row.exits_value),
    },
  );
  if (!esDistribuidor) {
    dayColumns.push({
      key: "purchases",
      header: "Compras",
      className: "whitespace-nowrap",
      render: (row) => formatCOP(row.entries_value),
    });
  }

  const activePreset = RANGE_PRESETS.find(
    (preset) => from === isoDaysAgo(preset.days) && to === isoDaysAgo(0),
  );

  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
        Analítica
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <PremiumBadge />
      </div>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        {esDistribuidor
          ? "Tus ventas a tiendas y el movimiento del período. Los gráficos resumen la operación; la tabla deja el detalle exacto."
          : "Ventas, compras y movimiento del período por día y por distribuidor. Los gráficos resumen la operación; la tabla deja el detalle exacto."}
      </p>

      <Box title="Rango">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <Field label="Desde">
            <input
              className={inputClass}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <input
              className={inputClass}
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-gray-500">Atajos</span>
            {RANGE_PRESETS.map((preset) => (
              <button
                key={preset.days}
                type="button"
                aria-pressed={activePreset?.days === preset.days}
                className={
                  activePreset?.days === preset.days
                    ? "rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm"
                    : "rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
                }
                onClick={() => {
                  setFrom(isoDaysAgo(preset.days));
                  setTo(isoDaysAgo(0));
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-gray-100 pt-3">
          <span className="text-xs font-medium text-gray-500">Mostrar gráficos en</span>
          <div
            role="group"
            aria-label="Métrica de los gráficos"
            className="inline-flex rounded-full border border-gray-200 bg-white p-0.5"
          >
            {(["value", "count"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={metric === option}
                className={
                  metric === option
                    ? "rounded-full bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm"
                    : "rounded-full px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
                }
                onClick={() => setMetric(option)}
              >
                {option === "value" ? "Valor (COP)" : "Cantidad"}
              </button>
            ))}
          </div>
        </div>

        {rangeError !== null && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {rangeError}
          </p>
        )}
        <Status loading={rows.loading} error={rows.error} />
      </Box>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <article
            key={kpi.label}
            className={
              kpi.tone === "dark"
                ? "relative overflow-hidden rounded-2xl bg-gray-900 p-4 text-white shadow-sm"
                : "rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm"
            }
          >
            {kpi.tone === "dark" && (
              <div className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
            )}
            <p
              className={
                kpi.tone === "dark"
                  ? "text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400"
                  : "text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500"
              }
            >
              {kpi.label}
            </p>
            <p
              className={
                kpi.tone === "dark"
                  ? "mt-2 break-words text-xl font-semibold tracking-tight tabular-nums sm:text-3xl"
                  : "mt-2 break-words text-xl font-semibold tracking-tight tabular-nums text-gray-900 sm:text-3xl"
              }
            >
              {kpi.value}
            </p>
            <p
              className={
                kpi.tone === "dark" ? "mt-1 text-xs text-gray-400" : "mt-1 text-xs text-gray-500"
              }
            >
              {kpi.hint}
            </p>
          </article>
        ))}
      </div>

      {!rows.loading && rangeOk && rows.error === null && data.length === 0 && (
        <Box title="Gráficos">
          <EmptyState
            title="Sin movimientos en el rango"
            hint="Probá con un rango más amplio o registrá entradas y salidas."
          />
        </Box>
      )}

      {rangeOk && data.length > 0 && (
        <>
          <Box title="Evolución del período">
            <p className="mb-3 text-xs text-gray-500">
              {esDistribuidor
                ? "Tus ventas a tiendas y el promedio de los últimos 7 días."
                : "Ventas de las tiendas y compras de abastecimiento, día por día."}
            </p>
            <LineChart
              labels={lineLabels}
              series={lineSeries}
              formatValue={(value) => formatMetricValue(value, metric)}
              formatAxis={(value) => formatMetricAxis(value, metric)}
              ariaLabel={`Evolución de ${
                esDistribuidor ? "tus ventas" : "ventas y compras"
              } entre el ${formatDay(from)} y el ${formatDay(to)}`}
            />
          </Box>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Box
              title={esDistribuidor ? "Ventas por día de la semana" : "Participación de ventas"}
              className="mt-0"
            >
              <DonutChart
                slices={donutSlices}
                centerLabel="Ventas"
                centerValue={formatMetricAxis(salesTotal, metric)}
                formatValue={(value) => formatMetricValue(value, metric)}
                ariaLabel={
                  esDistribuidor
                    ? "Participación de ventas por día de la semana"
                    : "Participación de ventas por distribuidor"
                }
              />
            </Box>

            <Box
              title={
                esDistribuidor ? "Mejores días del rango" : "Ventas y compras por distribuidor"
              }
              className="mt-0"
            >
              <BarChart
                items={barItems}
                series={barSeries}
                formatValue={(value) => formatMetricValue(value, metric)}
                ariaLabel={
                  esDistribuidor
                    ? "Mejores días del rango por ventas"
                    : "Ventas y compras por distribuidor"
                }
                emptyText={
                  esDistribuidor
                    ? "Sin ventas registradas en el rango."
                    : "Sin movimientos por distribuidor en el rango."
                }
              />
            </Box>
          </div>

          <Box title="Detalle por día">
            <ResponsiveTable
              caption="Movimientos por día"
              columns={dayColumns}
              rows={data}
              rowKey={(row) => `${row.day}-${row.distributor_id}`}
            />
          </Box>
        </>
      )}
    </section>
  );
}
