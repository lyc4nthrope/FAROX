import { Link } from "react-router-dom";

import { useLoad } from "../../../shared/hooks/useLoad";
import { formatCOP } from "../../../shared/lib/format";
import { fetchPlanQuote } from "../api";

const BENEFITS = [
  "Hasta 3 tiendas activas",
  "Dashboard de operación",
  "Movimientos manuales con precio",
  "Precios de compra/venta y venta directa",
] as const;

/** 0033/F3: sección pública de landing; el precio sale de quote_plan (anon). */
export function PremiumTeaser({ to }: { to: string }) {
  const monthly = useLoad(async () => {
    const result = await fetchPlanQuote("premium_monthly");
    return { data: result.quote, error: result.error };
  }, []);
  const annual = useLoad(async () => {
    const result = await fetchPlanQuote("premium_annual");
    return { data: result.quote, error: result.error };
  }, []);

  return (
    <section className="border-y border-gray-200 bg-gray-50">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">Premium</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Más tiendas y control para tu operación.
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-gray-600">
            Premium desbloquea el dashboard, los movimientos manuales y los precios de compra/venta.
            Si el plan vence, elegís una tienda principal; las demás se pausan sin borrar datos.
          </p>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {BENEFITS.map((benefit) => (
              <li key={benefit} className="flex gap-2 text-sm text-gray-700">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-900"
                />
                {benefit}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl bg-gray-900 p-6 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
            Precio de entrada
          </p>
          <p className="mt-2 text-3xl font-semibold tracking-tight">
            {monthly.data !== null ? formatCOP(monthly.data.finalCents / 100) : "10.000"}
            <span className="text-sm font-normal text-gray-300"> / mes</span>
          </p>
          <p className="mt-1 text-sm text-gray-300">
            {annual.data !== null
              ? `o ${formatCOP(annual.data.finalCents / 100)} al año`
              : "o 100.000 al año"}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-gray-400">
            IVA incluido. La comisión de Mercado Pago se descuenta del recaudo; el desglose completo
            está en la página de planes.
          </p>
          <Link
            to={to}
            className="mt-5 inline-flex rounded-lg bg-white px-5 py-3 text-sm font-semibold text-gray-900 transition hover:bg-gray-100 focus:outline-2 focus:outline-offset-2 focus:outline-white"
          >
            Crear cuenta y ver planes
          </Link>
        </div>
      </div>
    </section>
  );
}
