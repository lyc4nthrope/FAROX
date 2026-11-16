import { useState } from "react";
import { Link } from "react-router-dom";

import { useLoad } from "../../../shared/hooks/useLoad";
import { mapError } from "../../../shared/lib/errors/mapError";
import { formatCOP } from "../../../shared/lib/format";
import { Badge, Box, Status, buttonClass } from "../../../shared/ui/Box";
import {
  adminCancelSubscription,
  adminRefundPayment,
  fetchAdminPayments,
  fetchAdminSubscriptions,
  fetchPremiumHealth,
  reconcileSubscriptions,
} from "../api";
import type { AdminPaymentRow, AdminSubscriptionRow } from "../types";

function date(value: string | null): string {
  if (value === null) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("es-CO");
}

function subscriptionBadge(status: AdminSubscriptionRow["status"]) {
  if (status === "authorized") return <Badge tone="green">Activa</Badge>;
  if (status === "pending") return <Badge tone="amber">Pendiente</Badge>;
  if (status === "paused") return <Badge tone="amber">Pausada</Badge>;
  if (status === "cancelled") return <Badge tone="gray">Cancelada</Badge>;
  return <Badge tone="gray">Vencida</Badge>;
}

function paymentBadge(status: AdminPaymentRow["status"]) {
  if (status === "approved") return <Badge tone="green">Aprobado</Badge>;
  if (status === "pending") return <Badge tone="amber">Pendiente</Badge>;
  if (status === "rejected") return <Badge tone="red">Rechazado</Badge>;
  if (status === "refunded") return <Badge tone="gray">Reembolsado</Badge>;
  return <Badge tone="red">Contracargo</Badge>;
}

function HealthCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "gray" | "green" | "amber" | "red";
}) {
  const tones = {
    gray: "border-gray-200 bg-gray-50 text-gray-900",
    green: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
  } as const;
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <p className="text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/** F5: panel admin de suscripciones y pagos; acciones auditadas por Edge Functions. */
export function PremiumPaymentsAdminPage() {
  const [subscriptionsLimit, setSubscriptionsLimit] = useState(50);
  const [paymentsLimit, setPaymentsLimit] = useState(50);
  const subscriptions = useLoad(
    () => fetchAdminSubscriptions(subscriptionsLimit),
    [subscriptionsLimit],
  );
  const payments = useLoad(() => fetchAdminPayments(paymentsLimit), [paymentsLimit]);
  const health = useLoad(fetchPremiumHealth, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  async function cancel(subscriptionId: number): Promise<void> {
    const confirmed = window.confirm(
      "¿Cancelar esta suscripción en Mercado Pago? El acceso sigue hasta el final del período pagado.",
    );
    if (!confirmed) return;
    setBusy(`cancel-${subscriptionId}`);
    setMsg({ error: null, ok: null });
    const result = await adminCancelSubscription(subscriptionId);
    setBusy(null);
    if (result.error !== null) {
      setMsg({ error: mapError(result.error), ok: null });
      return;
    }
    setMsg({ error: null, ok: "Suscripción cancelada. El acceso sigue hasta el fin del período." });
    subscriptions.reload();
    health.reload();
  }

  async function refund(paymentId: number): Promise<void> {
    const confirmed = window.confirm(
      "¿Reembolsar este pago en Mercado Pago? El reembolso no revoca Premium automáticamente.",
    );
    if (!confirmed) return;
    setBusy(`refund-${paymentId}`);
    setMsg({ error: null, ok: null });
    const result = await adminRefundPayment(paymentId);
    setBusy(null);
    if (result.error !== null) {
      setMsg({ error: mapError(result.error), ok: null });
      return;
    }
    setMsg({ error: null, ok: "Pago reembolsado en Mercado Pago." });
    payments.reload();
    health.reload();
  }

  async function reconcile(): Promise<void> {
    setBusy("reconcile");
    setMsg({ error: null, ok: null });
    const result = await reconcileSubscriptions();
    setBusy(null);
    if (result.error !== null || result.result === null) {
      setMsg({ error: mapError(result.error ?? { message: "No se pudo conciliar." }), ok: null });
      return;
    }
    setMsg({
      error: null,
      ok: `Conciliación: ${result.result.checkedSubscriptions} suscripciones, ${result.result.checkedPayments} pagos, ${result.result.updated} actualizados.`,
    });
    subscriptions.reload();
    payments.reload();
    health.reload();
  }

  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
        Administración
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Pagos y suscripciones</h1>
        <button
          className={`${buttonClass} px-3 py-1.5 text-xs`}
          type="button"
          disabled={busy !== null}
          onClick={() => void reconcile()}
        >
          {busy === "reconcile" ? "Conciliando…" : "Conciliar con Mercado Pago"}
        </button>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Mostrando los movimientos más recientes; usá «Cargar más» para ver anteriores. Cancelar
        detiene la renovación; reembolsar no revoca Premium automáticamente. El ajuste manual de
        Premium se hace desde{" "}
        <Link to="/users" className="underline underline-offset-4">
          Usuarios
        </Link>
        .
      </p>

      <Status
        loading={subscriptions.loading || payments.loading}
        error={subscriptions.error ?? payments.error}
      />
      <Status error={msg.error} ok={msg.ok} />

      <div className="mt-5">
        <Box title="Salud de pagos">
          <Status loading={health.loading} error={health.error} />
          {health.data !== null && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <HealthCard
                label="Pagos pendientes > 1 h"
                value={health.data.stalePendingPayments}
                tone={health.data.stalePendingPayments > 0 ? "amber" : "green"}
              />
              <HealthCard
                label="Suscripciones pendientes > 1 h"
                value={health.data.stalePendingSubscriptions}
                tone={health.data.stalePendingSubscriptions > 0 ? "amber" : "green"}
              />
              <HealthCard
                label="Avisos fallidos"
                value={health.data.failedNotices}
                tone={health.data.failedNotices > 0 ? "red" : "green"}
              />
              <HealthCard
                label="Usuarios en gracia"
                value={health.data.graceUsers}
                tone={health.data.graceUsers > 0 ? "amber" : "gray"}
              />
              <HealthCard
                label="Eventos webhook 24 h"
                value={health.data.webhookEvents24h}
                tone="gray"
              />
            </div>
          )}
        </Box>
      </div>

      <div className="mt-5">
        <Box title="Suscripciones">
          {subscriptions.data !== null && subscriptions.data.length === 0 && (
            <p className="text-sm text-gray-500">No hay suscripciones registradas.</p>
          )}
          {subscriptions.data !== null && subscriptions.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3 font-medium">Usuario</th>
                    <th className="py-2 pr-3 font-medium">Plan</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 pr-3 font-medium">Precio</th>
                    <th className="py-2 pr-3 font-medium">Ref. MP</th>
                    <th className="py-2 pr-3 font-medium">Vence</th>
                    <th className="py-2 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.data.map((row) => {
                    const canCancel =
                      row.status === "pending" ||
                      row.status === "authorized" ||
                      row.status === "paused";
                    return (
                      <tr key={row.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-gray-900">{row.userName}</p>
                          <p className="text-xs text-gray-500">{row.userEmail ?? "—"}</p>
                        </td>
                        <td className="py-2 pr-3 text-gray-700">{row.planName ?? "—"}</td>
                        <td className="py-2 pr-3">{subscriptionBadge(row.status)}</td>
                        <td className="py-2 pr-3 tabular-nums text-gray-900">
                          {formatCOP(row.priceCents / 100)} {row.currency}
                        </td>
                        <td
                          className="py-2 pr-3 font-mono text-xs text-gray-500"
                          title={row.providerSubscriptionId ?? undefined}
                        >
                          {row.providerSubscriptionId === null
                            ? "—"
                            : `${row.providerSubscriptionId.slice(0, 12)}…`}
                        </td>
                        <td className="py-2 pr-3 text-gray-600">
                          {date(row.currentPeriodEnd)}
                          {row.cancelAtPeriodEnd && (
                            <span className="ml-1 text-xs text-amber-700">(no renueva)</span>
                          )}
                        </td>
                        <td className="py-2">
                          {canCancel ? (
                            <button
                              className={`${buttonClass} px-2.5 py-1 text-xs`}
                              type="button"
                              disabled={busy !== null}
                              onClick={() => void cancel(row.id)}
                            >
                              {busy === `cancel-${row.id}` ? "Cancelando…" : "Cancelar"}
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {subscriptions.data !== null && subscriptions.data.length === subscriptionsLimit && (
            <button
              className={`${buttonClass} mt-3 px-3 py-1.5 text-xs`}
              type="button"
              disabled={busy !== null}
              onClick={() => setSubscriptionsLimit((current) => current + 50)}
            >
              Cargar más suscripciones
            </button>
          )}
        </Box>
      </div>

      <div className="mt-5">
        <Box title="Pagos">
          {payments.data !== null && payments.data.length === 0 && (
            <p className="text-sm text-gray-500">No hay pagos registrados.</p>
          )}
          {payments.data !== null && payments.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-3 font-medium">Usuario</th>
                    <th className="py-2 pr-3 font-medium">Plan</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 pr-3 font-medium">Monto</th>
                    <th className="py-2 pr-3 font-medium">Ref. MP</th>
                    <th className="py-2 pr-3 font-medium">Fecha</th>
                    <th className="py-2 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.data.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-gray-900">{row.userName}</p>
                        <p className="text-xs text-gray-500">{row.userEmail ?? "—"}</p>
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{row.planName ?? "—"}</td>
                      <td className="py-2 pr-3">{paymentBadge(row.status)}</td>
                      <td className="py-2 pr-3 tabular-nums text-gray-900">
                        {formatCOP(row.amountCents / 100)} {row.currency}
                      </td>
                      <td
                        className="py-2 pr-3 font-mono text-xs text-gray-500"
                        title={row.providerPaymentId ?? undefined}
                      >
                        {row.providerPaymentId === null
                          ? "—"
                          : `${row.providerPaymentId.slice(0, 12)}…`}
                      </td>
                      <td className="py-2 pr-3 text-gray-600">
                        {date(row.paidAt ?? row.createdAt)}
                      </td>
                      <td className="py-2">
                        {row.status === "approved" && row.providerPaymentId !== null ? (
                          <button
                            className={`${buttonClass} px-2.5 py-1 text-xs`}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void refund(row.id)}
                          >
                            {busy === `refund-${row.id}` ? "Reembolsando…" : "Reembolsar"}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {payments.data !== null && payments.data.length === paymentsLimit && (
            <button
              className={`${buttonClass} mt-3 px-3 py-1.5 text-xs`}
              type="button"
              disabled={busy !== null}
              onClick={() => setPaymentsLimit((current) => current + 50)}
            >
              Cargar más pagos
            </button>
          )}
        </Box>
      </div>
    </section>
  );
}
