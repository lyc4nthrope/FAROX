import { useState } from "react";
import { Link } from "react-router-dom";

import { useLoad } from "../../../shared/hooks/useLoad";
import { mapError } from "../../../shared/lib/errors/mapError";
import { formatCOP } from "../../../shared/lib/format";
import { goTo } from "../../../shared/lib/navigation";
import { Box, Status, buttonClass } from "../../../shared/ui/Box";
import { createSubscription, fetchMyPremiumStatus, fetchPlanQuote } from "../api";
import { isPremiumCheckoutEnabled } from "../flags";
import { formatPremiumDate } from "../format";
import type { PlanQuote } from "../types";

const COMPARISON: readonly {
  label: string;
  free: string | boolean;
  premium: string | boolean;
}[] = [
  { label: "Tiendas activas", free: "1", premium: "Hasta 3" },
  { label: "Inventario, pedidos y entregas", free: true, premium: true },
  { label: "Rutas, fiado y alertas", free: true, premium: true },
  { label: "Dashboard", free: false, premium: true },
  { label: "Movimientos manuales", free: false, premium: true },
  { label: "Precios de compra/venta y venta directa", free: false, premium: true },
  { label: "QR masivo", free: false, premium: "Próximamente" },
];

const FAQ: readonly { question: string; answer: string }[] = [
  {
    question: "¿Cómo se renueva?",
    answer:
      "La suscripción se cobra automáticamente con Mercado Pago. Podés cancelar cuando quieras desde tu perfil, sin penalidad.",
  },
  {
    question: "¿Qué pasa si no renuevo?",
    answer:
      "Elegís una tienda principal; las demás se pausan y conservan stock, pedidos, rutas y créditos. Al renovar podés reactivarlas.",
  },
  {
    question: "¿El precio incluye impuestos?",
    answer:
      "Sí. El desglose muestra el IVA incluido y la comisión estimada de Mercado Pago, que se descuenta del recaudo.",
  },
  {
    question: "¿Puedo pagar con PSE?",
    answer:
      "Mercado Pago define qué medios permiten cobros recurrentes. La tarjeta o la cuenta de Mercado Pago son la opción principal para la renovación automática; PSE se confirmará al activar el pago.",
  },
  {
    question: "¿Puedo cambiar de plan?",
    answer:
      "Sí, cuando el pago esté activo vas a poder pasar de mensual a anual. Las suscripciones existentes conservan su precio.",
  },
];

function Value({ value }: { value: string | boolean }) {
  if (typeof value === "string") return <span className="text-sm text-gray-900">{value}</span>;
  return value ? (
    <span className="text-sm font-medium text-emerald-700">Sí</span>
  ) : (
    <span className="text-sm text-gray-400">—</span>
  );
}

function QuoteCard({
  title,
  interval,
  quote,
  loading,
  error,
  disabled,
  busy,
  ctaLabel,
  onSubscribe,
}: {
  title: string;
  interval: string;
  quote: PlanQuote | null;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  busy: boolean;
  ctaLabel: string;
  onSubscribe: () => void;
}) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">{interval}</p>
      <h2 className="mt-1 text-lg font-semibold tracking-tight text-gray-900">{title}</h2>
      <Status loading={loading} error={error} />
      {quote !== null && (
        <>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
            {formatCOP(quote.finalCents / 100)}
            <span className="ml-1 text-sm font-normal text-gray-500">COP</span>
          </p>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">IVA incluido</dt>
              <dd className="tabular-nums text-gray-900">{formatCOP(quote.taxCents / 100)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-gray-500">Mercado Pago estimado</dt>
              <dd className="tabular-nums text-gray-900">{formatCOP(quote.mpFeeCents / 100)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-gray-100 pt-1.5">
              <dt className="font-medium text-gray-700">Neto FAROX</dt>
              <dd className="tabular-nums font-medium text-gray-900">
                {formatCOP(quote.netCents / 100)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-gray-500">
            La comisión de Mercado Pago se descuenta del recaudo; no se suma al precio.
          </p>
        </>
      )}
      <div className="mt-auto pt-4">
        <button
          className={buttonClass}
          type="button"
          disabled={disabled || busy || quote === null}
          onClick={onSubscribe}
        >
          {busy ? "Redirigiendo…" : ctaLabel}
        </button>
      </div>
    </div>
  );
}

/** 0033/F3: página de planes, comparativa, desglose y FAQ. */
export function PremiumPage() {
  const monthly = useLoad(async () => {
    const result = await fetchPlanQuote("premium_monthly");
    return { data: result.quote, error: result.error };
  }, []);
  const annual = useLoad(async () => {
    const result = await fetchPlanQuote("premium_annual");
    return { data: result.quote, error: result.error };
  }, []);
  const status = useLoad(fetchMyPremiumStatus, []);
  const premium = status.data?.premium === true;
  const until = formatPremiumDate(status.data?.premiumUntil ?? null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const checkoutEnabled = isPremiumCheckoutEnabled();

  async function subscribe(planCode: string): Promise<void> {
    setBusyPlan(planCode);
    setCheckoutError(null);
    const result = await createSubscription(planCode);
    setBusyPlan(null);
    if (result.error !== null) {
      setCheckoutError(mapError(result.error));
      return;
    }
    if (result.data !== null) {
      goTo(result.data.initPoint);
    }
  }

  const checkoutDisabled = status.loading || status.error !== null || !checkoutEnabled;
  const ctaLabel = premium
    ? "Ya sos Premium"
    : checkoutEnabled
      ? "Suscribirme"
      : "Pago disponible próximamente";

  return (
    <section className="mx-auto max-w-4xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">Plan</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Premium</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Hasta 3 tiendas, dashboard, movimientos manuales y precios de compra/venta. El cobro se hace
        con Mercado Pago; podés cancelar la renovación cuando quieras y el acceso sigue hasta el
        final del período pagado.
      </p>

      <Status loading={status.loading} error={status.error} />
      {!checkoutEnabled && !premium && (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          El pago con Mercado Pago se está habilitando gradualmente. Mientras tanto, el
          administrador puede activar Premium manualmente.
        </p>
      )}
      {premium && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Ya sos Premium{until === null ? " (manual)" : ` hasta el ${until}`}.{" "}
          <Link to="/premium/tiendas" className="font-medium underline underline-offset-4">
            Gestionar mis tiendas
          </Link>
        </div>
      )}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <QuoteCard
          title="Premium mensual"
          interval="Cada mes"
          quote={monthly.data}
          loading={monthly.loading}
          error={monthly.error}
          disabled={premium || checkoutDisabled}
          busy={busyPlan === "premium_monthly"}
          ctaLabel={ctaLabel}
          onSubscribe={() => void subscribe("premium_monthly")}
        />
        <QuoteCard
          title="Premium anual"
          interval="Cada 12 meses"
          quote={annual.data}
          loading={annual.loading}
          error={annual.error}
          disabled={premium || checkoutDisabled}
          busy={busyPlan === "premium_annual"}
          ctaLabel={ctaLabel}
          onSubscribe={() => void subscribe("premium_annual")}
        />
      </div>

      <Status error={checkoutError} />
      <p className="mt-2 text-xs text-gray-500">
        Al continuar vas a Mercado Pago para autorizar el cobro automático. No guardamos datos de
        tarjeta.
      </p>

      <div className="mt-6">
        <Box title="Gratis vs Premium">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                  <th className="py-2 pr-3 font-medium">Función</th>
                  <th className="py-2 pr-3 text-center font-medium">Gratis</th>
                  <th className="py-2 text-center font-medium">Premium</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3 text-gray-700">{row.label}</td>
                    <td className="py-2 pr-3 text-center">
                      <Value value={row.free} />
                    </td>
                    <td className="py-2 text-center">
                      <Value value={row.premium} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>
      </div>

      <div className="mt-6">
        <Box title="Preguntas frecuentes">
          <div className="divide-y divide-gray-100">
            {FAQ.map((item) => (
              <details key={item.question} className="group py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-gray-900">
                  {item.question}
                </summary>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{item.answer}</p>
              </details>
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-500">
            Más información en la{" "}
            <Link to="/privacidad" className="underline underline-offset-4">
              Política de Privacidad
            </Link>
            . La cancelación no tiene penalidad; el acceso sigue hasta el final del período pagado.
          </p>
        </Box>
      </div>
    </section>
  );
}
