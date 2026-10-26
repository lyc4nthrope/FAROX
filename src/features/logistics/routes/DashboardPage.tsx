import { useState } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { supabase } from "../../../shared/lib/supabase/client";
import { Box, Field, Status, inputClass } from "../../../shared/ui/Box";
import { EmptyState, ExampleDashboard, PremiumLock } from "../../../shared/ui";
import { formatCOP } from "../../../shared/lib/format";

interface DashboardRow {
  day: string;
  distributor_id: number;
  entries_count: number;
  exits_count: number;
  entries_value: number;
  exits_value: number;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toLocaleDateString("en-CA");
}

const RANGE_PRESETS = [
  { label: "7 días", days: 7 },
  { label: "30 días", days: 30 },
  { label: "90 días", days: 90 },
] as const;

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("es-CO", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

async function fetchDashboard(from: string, to: string) {
  const { data, error } = await supabase.rpc("get_dashboard", { p_from: from, p_to: to });
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    day: String(r.day),
    distributor_id: Number(r.distributor_id),
    entries_count: Number(r.entries_count),
    exits_count: Number(r.exits_count),
    entries_value: Number(r.entries_value),
    exits_value: Number(r.exits_value),
  }));
  return { data: rows, error };
}

async function fetchDistributorNames() {
  const { data, error } = await supabase.from("distributors").select("id,name").limit(500);
  const map: Record<number, string> = {};
  for (const d of (data ?? []) as { id: number; name: string }[]) map[d.id] = d.name;
  return { data: map, error };
}

/**
 * /dashboard — INT-01: entradas y salidas por día y por distribuidor.
 * Conteos y valores; nunca se suman cantidades de productos distintos.
 */
export function DashboardPage() {
  const { premium } = useAuth();
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const rangeOk = from <= to;
  const rows = useLoad(
    () =>
      premium && rangeOk
        ? fetchDashboard(from, to)
        : Promise.resolve({ data: [] as DashboardRow[], error: null }),
    [from, to, premium],
  );
  const names = useLoad(() => fetchDistributorNames(), []);

  if (!premium) {
    return (
      <section>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
          Analítica
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          El pulso de tu operación: qué entró, qué salió y cuánto se movió en cada distribuidor.
        </p>
        <PremiumLock
          title="Dashboard analítico"
          benefits={[
            "Entradas y salidas por día y por distribuidor.",
            "Totales y valores en pesos del rango que elijas.",
            "Compará el movimiento de cada distribuidor en el mismo período.",
          ]}
          preview={
            <ExampleDashboard
              stats={[
                { label: "Entradas del rango", value: "128", hint: "valor $1.240.000" },
                { label: "Salidas del rango", value: "94", hint: "valor $860.000" },
              ]}
              stops={["Sin distribuidor (manual)", "Distribuidora Norte", "Distribuidora Sur"]}
            />
          }
        />
      </section>
    );
  }

  const data = rows.data ?? [];
  const totals = data.reduce(
    (acc, r) => ({
      entries: acc.entries + r.entries_count,
      exits: acc.exits + r.exits_count,
      entriesValue: acc.entriesValue + r.entries_value,
      exitsValue: acc.exitsValue + r.exits_value,
    }),
    { entries: 0, exits: 0, entriesValue: 0, exitsValue: 0 },
  );
  const byDistributor = new Map<number, { entries: number; exits: number; value: number }>();
  for (const r of data) {
    const cur = byDistributor.get(r.distributor_id) ?? { entries: 0, exits: 0, value: 0 };
    byDistributor.set(r.distributor_id, {
      entries: cur.entries + r.entries_count,
      exits: cur.exits + r.exits_count,
      value: cur.value + r.entries_value,
    });
  }
  const distributorRows = [...byDistributor.entries()].sort(
    (a, b) => b[1].entries + b[1].exits - (a[1].entries + a[1].exits),
  );
  const maxFlow = Math.max(1, ...distributorRows.map(([, v]) => Math.max(v.entries, v.exits)));
  const label = (id: number) =>
    id === 0 ? "Sin distribuidor (manual)" : (names.data?.[id] ?? `#${id}`);
  const activePreset = RANGE_PRESETS.find(
    (preset) => from === isoDaysAgo(preset.days) && to === isoDaysAgo(0),
  );

  const kpis = [
    {
      label: "Entradas",
      value: rows.loading ? "—" : String(totals.entries),
      hint: `Valor ${formatCOP(totals.entriesValue)}`,
      tone: "dark" as const,
    },
    {
      label: "Salidas",
      value: rows.loading ? "—" : String(totals.exits),
      hint: `Valor ${formatCOP(totals.exitsValue)}`,
      tone: "light" as const,
    },
    {
      label: "Movimientos",
      value: rows.loading ? "—" : String(totals.entries + totals.exits),
      hint: "Entradas y salidas juntas",
      tone: "light" as const,
    },
    {
      label: "Distribuidores",
      value: rows.loading ? "—" : String(distributorRows.length),
      hint: "Con movimiento en el rango",
      tone: "light" as const,
    },
  ];

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Analítica
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
          <svg aria-hidden="true" className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2.5 14.6 9l6.9.5-5.3 4.5 1.7 6.7-5.9-3.6-5.9 3.6 1.7-6.7L2.5 9.5 9.4 9 12 2.5Z" />
          </svg>
          Premium
        </span>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Entradas y salidas por día y por distribuidor. Los conteos y valores nunca mezclan
        cantidades de productos distintos.
      </p>

      <Box title="Rango">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <Field label="Desde">
            <input
              className={inputClass}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <input
              className={inputClass}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
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
        {!rangeOk && (
          <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            La fecha inicial debe ser anterior a la final.
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
                  : "text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400"
              }
            >
              {kpi.label}
            </p>
            <p
              className={
                kpi.tone === "dark"
                  ? "mt-2 text-3xl font-semibold tracking-tight"
                  : "mt-2 text-3xl font-semibold tracking-tight text-gray-900"
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

      {distributorRows.length > 0 && (
        <Box title="Por distribuidor">
          <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-gray-900" />
              Entradas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Salidas
            </span>
          </div>
          <ul className="space-y-3">
            {distributorRows.map(([id, v]) => (
              <li key={id} className="rounded-xl border border-gray-100 bg-gray-50/40 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="truncate text-sm font-medium text-gray-900">{label(id)}</span>
                  <span className="text-xs text-gray-500">
                    {v.entries} entradas · {v.exits} salidas
                  </span>
                </div>
                <div className="mt-2 flex h-2 gap-1 overflow-hidden rounded-full bg-gray-200/70">
                  <span
                    className="h-full rounded-full bg-gray-900"
                    style={{ width: `${(v.entries / maxFlow) * 100}%` }}
                  />
                  <span
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${(v.exits / maxFlow) * 100}%` }}
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500">
                  Valor entradas {formatCOP(v.value)}
                </p>
              </li>
            ))}
          </ul>
        </Box>
      )}

      <Box title="Por día">
        {!rows.loading && data.length === 0 ? (
          <EmptyState
            title="Sin movimientos en el rango"
            hint="Probá con un rango más amplio o registrá entradas y salidas."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>Día</th>
                  <th>Distribuidor</th>
                  <th>Entradas</th>
                  <th>Salidas</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r) => (
                  <tr key={`${r.day}-${r.distributor_id}`}>
                    <td className="whitespace-nowrap">{formatDay(r.day)}</td>
                    <td>{label(r.distributor_id)}</td>
                    <td>{r.entries_count}</td>
                    <td>{r.exits_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>
    </section>
  );
}
