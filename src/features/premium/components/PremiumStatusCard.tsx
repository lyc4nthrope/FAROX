import { useState } from "react";
import { Link } from "react-router-dom";

import { useLoad } from "../../../shared/hooks/useLoad";
import { mapError } from "../../../shared/lib/errors/mapError";
import { Badge, Status, buttonClass } from "../../../shared/ui/Box";
import { cancelSubscription, fetchMyPremiumStatus, fetchMySubscription } from "../api";
import { formatPremiumDate } from "../format";

/**
 * 0032: estado del plan en /profile. La fuente es my_premium_status(); el
 * cliente no decide si es Premium. La página /premium y el modal de downgrade
 * llegan en fases posteriores; acá solo se informa el estado.
 */
export function PremiumStatusCard() {
  const status = useLoad(fetchMyPremiumStatus, []);
  const subscription = useLoad(fetchMySubscription, []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  async function cancel(): Promise<void> {
    const confirmed = window.confirm(
      "¿Cancelar la renovación? El acceso sigue hasta el final del período pagado.",
    );
    if (!confirmed) return;
    setBusy(true);
    setMsg({ error: null, ok: null });
    const result = await cancelSubscription();
    setBusy(false);
    if (result.error !== null) {
      setMsg({ error: mapError(result.error), ok: null });
      return;
    }
    setMsg({
      error: null,
      ok: "Renovación cancelada. El acceso sigue hasta el final del período.",
    });
    subscription.reload();
    status.reload();
  }

  if (status.loading) {
    return <Status loading />;
  }
  if (status.error !== null) {
    return <Status error={status.error} />;
  }
  if (status.data === null) {
    return <p className="text-sm text-gray-600">No pudimos leer tu plan.</p>;
  }

  const { premium, premiumUntil, premiumGraceUntil, graceActive, needsStoreChoice } = status.data;
  const until = formatPremiumDate(premiumUntil);
  const graceUntil = formatPremiumDate(premiumGraceUntil);
  const subscriptionEnd = formatPremiumDate(subscription.data?.currentPeriodEnd ?? null);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-gray-900">{premium ? "Premium" : "Plan gratuito"}</span>
        {premium ? <Badge tone="amber">Activo</Badge> : <Badge tone="gray">Gratis</Badge>}
      </div>

      {premium && (
        <p className="text-gray-600">
          {until === null
            ? "Grant manual del administrador (sin vencimiento)."
            : `Activo hasta el ${until}.`}
        </p>
      )}

      {!premium && graceActive && (
        <p className="text-amber-800">
          Tu Premium venció. Tenés hasta el {graceUntil ?? "próximamente"} para elegir una tienda
          principal o renovar.
        </p>
      )}

      {!premium && !graceActive && needsStoreChoice && (
        <p className="text-amber-800">
          Tenés más de una tienda activa. Elegí una tienda principal para continuar.
        </p>
      )}

      {!premium && !graceActive && !needsStoreChoice && (
        <p className="text-gray-600">
          Con Premium podés tener hasta 3 tiendas, dashboard, movimientos manuales y precios de
          compra/venta.
        </p>
      )}

      {subscription.data !== null && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="font-medium text-gray-900">
            {subscription.data.planName ?? "Premium"}
            {subscriptionEnd !== null && (
              <span className="font-normal text-gray-600"> · hasta el {subscriptionEnd}</span>
            )}
          </p>
          <p className="mt-1 text-gray-600">
            {subscription.data.status === "cancelled" || subscription.data.cancelAtPeriodEnd
              ? "Renovación cancelada. El acceso sigue hasta el final del período pagado."
              : subscription.data.status === "paused"
                ? "La suscripción está pausada. No se renueva hasta reactivarla."
                : subscription.data.status === "pending"
                  ? "Suscripción pendiente de autorización en Mercado Pago."
                  : subscription.data.status === "expired"
                    ? "La suscripción venció. Podés renovar desde la página de planes."
                    : "Renovación automática activa con Mercado Pago."}
          </p>
          {subscription.data.status !== "cancelled" &&
            subscription.data.status !== "expired" &&
            !subscription.data.cancelAtPeriodEnd && (
              <button
                className={`${buttonClass} mt-3 px-3 py-1.5 text-xs`}
                type="button"
                disabled={busy}
                onClick={() => void cancel()}
              >
                {busy ? "Cancelando…" : "Cancelar suscripción"}
              </button>
            )}
        </div>
      )}

      <Status error={subscription.error} />
      <Status error={msg.error} ok={msg.ok} />

      <div className="flex flex-wrap gap-4">
        <Link
          to="/premium"
          className="inline-flex text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
        >
          Ver planes
        </Link>
        <Link
          to="/premium/tiendas"
          className="inline-flex text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
        >
          Gestionar mis tiendas
        </Link>
      </div>
    </div>
  );
}
