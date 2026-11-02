import { Link } from "react-router-dom";

import { useLoad } from "../../../shared/hooks/useLoad";
import { formatCOP } from "../../../shared/lib/format";
import { Box, Status, buttonClass } from "../../../shared/ui/Box";
import { fetchPlanQuote } from "../api";
import type { PlanQuote } from "../types";

function QuoteCard({
  title,
  interval,
  quote,
  loading,
  error,
}: {
  title: string;
  interval: string;
  quote: PlanQuote | null;
  loading: boolean;
  error: string | null;
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
        <button className={buttonClass} type="button" disabled>
          Pago disponible próximamente
        </button>
      </div>
    </div>
  );
}

/**
 * 0033: primera versión de /premium. Muestra el desglose real de quote_plan y
 * deja el botón de pago deshabilitado hasta conectar Mercado Pago (F4).
 */
export function PremiumPage() {
  const monthly = useLoad(async () => {
    const result = await fetchPlanQuote("premium_monthly");
    return { data: result.quote, error: result.error };
  }, []);
  const annual = useLoad(async () => {
    const result = await fetchPlanQuote("premium_annual");
    return { data: result.quote, error: result.error };
  }, []);

  return (
    <section className="mx-auto max-w-4xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Plan</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Premium</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Hasta 3 tiendas, dashboard, movimientos manuales y precios de compra/venta. El pago con
        Mercado Pago se activa en la siguiente fase; mientras tanto, el administrador puede activar
        Premium manualmente.
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <QuoteCard
          title="Premium mensual"
          interval="Cada mes"
          quote={monthly.data}
          loading={monthly.loading}
          error={monthly.error}
        />
        <QuoteCard
          title="Premium anual"
          interval="Cada 12 meses"
          quote={annual.data}
          loading={annual.loading}
          error={annual.error}
        />
      </div>

      <Box title="Después de pagar">
        <p className="text-sm text-gray-600">
          El perfil muestra la vigencia y desde ahí podés gestionar tus tiendas. Si el plan vence,
          elegís una tienda principal o renovás; las demás se pausan, nunca se borran.
        </p>
        <Link
          to="/premium/tiendas"
          className="mt-3 inline-flex text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
        >
          Gestionar mis tiendas
        </Link>
      </Box>
    </section>
  );
}
