import { useEffect } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { Status, buttonClass } from "../../../shared/ui/Box";
import { fetchMyPremiumStatus } from "../api";
import { formatPremiumDate } from "../format";

/** F4: retorno desde Mercado Pago; confirma el estado real en la DB. */
export function PremiumResultPage() {
  const status = useLoad(fetchMyPremiumStatus, []);
  const { refreshPrivileges } = useAuth();
  const premium = status.data?.premium === true;
  const until = formatPremiumDate(status.data?.premiumUntil ?? null);

  useEffect(() => {
    void refreshPrivileges();
  }, [refreshPrivileges]);

  function refresh(): void {
    void refreshPrivileges();
    status.reload();
  }

  return (
    <section className="mx-auto max-w-xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
        Mercado Pago
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Estado del pago</h1>
      <Status loading={status.loading} error={status.error} />

      {premium && (
        <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Premium activo.</p>
          <p className="mt-1">
            {until === null
              ? "Tu cuenta tiene Premium activo."
              : `Tenés acceso hasta el ${until}. La renovación se cobra automáticamente con Mercado Pago.`}
          </p>
        </div>
      )}

      {!premium && !status.loading && status.error === null && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Pago pendiente de confirmación.</p>
          <p className="mt-1">
            Mercado Pago puede tardar unos segundos en avisarnos. Si ya pagaste, actualizá el estado.
            Si el pago fue rechazado, podés intentarlo de nuevo desde la página de planes.
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <button className={buttonClass} type="button" onClick={refresh}>
          Actualizar estado
        </button>
        <Link
          to="/premium"
          className="inline-flex items-center text-sm font-medium text-gray-700 underline-offset-4 hover:underline"
        >
          Volver a planes
        </Link>
        {premium && (
          <Link
            to="/premium/tiendas"
            className="inline-flex items-center text-sm font-medium text-gray-900 underline-offset-4 hover:underline"
          >
            Gestionar mis tiendas
          </Link>
        )}
      </div>
    </section>
  );
}
