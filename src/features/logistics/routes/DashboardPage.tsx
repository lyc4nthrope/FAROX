import { useState } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { supabase } from "../../../shared/lib/supabase/client";
import { Box, Field, Status, inputClass } from "../../../shared/ui/Box";
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
    () => (premium && rangeOk ? fetchDashboard(from, to) : Promise.resolve({ data: [] as DashboardRow[], error: null })),
    [from, to, premium],
  );
  const names = useLoad(() => fetchDistributorNames(), []);

  if (!premium) {
    return (
      <section>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="mt-2 text-amber-700">El dashboard analítico requiere una cuenta Premium.</p>
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
  const label = (id: number) => (id === 0 ? "Sin distribuidor (manual)" : (names.data?.[id] ?? `#${id}`));

  return (
    <section>
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <Box title="Rango">
        <div className="flex gap-4">
          <Field label="Desde">
            <input className={inputClass} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <input className={inputClass} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {!rangeOk && <p className="text-red-700">La fecha inicial debe ser anterior a la final.</p>}
        <Status loading={rows.loading} error={rows.error} />
      </Box>
      <Box title="Totales del rango">
        <ul className="text-sm">
          <li>Entradas: {totals.entries} (valor {formatCOP(totals.entriesValue)})</li>
          <li>Salidas: {totals.exits} (valor {formatCOP(totals.exitsValue)})</li>
        </ul>
      </Box>
      <Box title="Por distribuidor">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Distribuidor</th>
              <th>Entradas</th>
              <th>Salidas</th>
              <th>Valor entradas</th>
            </tr>
          </thead>
          <tbody>
            {[...byDistributor.entries()].map(([id, v]) => (
              <tr key={id}>
                <td>{label(id)}</td>
                <td>{v.entries}</td>
                <td>{v.exits}</td>
                <td>{formatCOP(v.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
      <Box title="Por día">
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
                <td>{r.day}</td>
                <td>{label(r.distributor_id)}</td>
                <td>{r.entries_count}</td>
                <td>{r.exits_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && !rows.loading && <p>Sin movimientos en el rango.</p>}
      </Box>
    </section>
  );
}
