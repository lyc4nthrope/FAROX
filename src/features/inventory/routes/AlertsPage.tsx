import { useState } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { Badge, Box, Status, buttonClass, runAction } from "../../../shared/ui/Box";
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

  return (
    <section>
      <h1 className="text-xl font-semibold">Alertas</h1>
      <Status error={error} />
      <Box title="Alertas abiertas">
        <Status loading={alerts.loading} error={alerts.error} />
        {alerts.data?.length === 0 && <p>No hay alertas abiertas.</p>}
        <ul className="flex flex-col gap-2">
          {alerts.data?.map((a) => (
            <li key={a.id} className="rounded border border-gray-200 p-2 text-sm">
              <Badge tone={a.type === "stock_low" || a.type === "credit_overdue" ? "red" : "amber"}>{ALERT_LABELS[a.type] ?? a.type}</Badge>{" "}
              {a.message}
              <div className="text-xs text-gray-600">
                {new Date(a.created_at).toLocaleString("es-CO")}
                {a.read_at !== null && " · leída"}
              </div>
              {a.read_at === null && (
                <button className={buttonClass} type="button" onClick={() => void onRead(a.id)}>
                  Marcar leída
                </button>
              )}
            </li>
          ))}
        </ul>
      </Box>
    </section>
  );
}
