import { useState } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { EmptyState } from "../../../shared/ui";
import { Badge, Box, Status, runAction, secondaryButtonClass } from "../../../shared/ui/Box";
import { ALERT_LABELS, fetchOpenAlerts, markAlertRead } from "../alertsApi";

/** /alertas — alertas abiertas del alcance del usuario. */
export function AlertsPage() {
  const alerts = useLoad(() => fetchOpenAlerts(), []);
  const [error, setError] = useState<string | null>(null);

  async function onRead(id: number) {
    const result = await runAction(() => markAlertRead(id));
    setError(result);
    if (result === null) alerts.reload();
  }

  const open = (alerts.data ?? []).filter((a) => a.read_at === null).length;

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Inventario
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Alertas</h1>
        {alerts.data !== null && (
          <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-500">
            {open} {open === 1 ? "abierta" : "abiertas"}
          </span>
        )}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Lo que necesita atención: stock bajo, vencimientos y créditos atrasados de tu alcance.
      </p>
      <Status error={error} />

      <Box title="Alertas abiertas">
        <Status loading={alerts.loading} error={alerts.error} />
        {alerts.data?.length === 0 && !alerts.loading && (
          <EmptyState
            title="No hay alertas abiertas"
            hint="Cuando un producto se agote, venza o un crédito se atrase, va a aparecer acá."
          />
        )}
        <ul className="flex flex-col gap-2">
          {alerts.data?.map((a) => {
            const critical = a.type === "stock_low" || a.type === "credit_overdue";
            return (
              <li
                key={a.id}
                className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-start sm:justify-between ${
                  critical ? "border-red-200 bg-red-50/40" : "border-amber-200 bg-amber-50/30"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={critical ? "red" : "amber"}>
                      {ALERT_LABELS[a.type] ?? a.type}
                    </Badge>
                    {a.read_at !== null && (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                        Leída
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm text-gray-800">{a.message}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {new Date(a.created_at).toLocaleString("es-CO")}
                  </p>
                </div>
                {a.read_at === null && (
                  <button
                    className={`${secondaryButtonClass} shrink-0`}
                    type="button"
                    onClick={() => void onRead(a.id)}
                  >
                    Marcar leída
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </Box>
    </section>
  );
}
