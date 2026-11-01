import { useLoad } from "../../../shared/hooks/useLoad";
import { Badge, Status } from "../../../shared/ui/Box";
import { fetchMyPremiumStatus } from "../api";

function formatDate(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * 0032: estado del plan en /profile. La fuente es my_premium_status(); el
 * cliente no decide si es Premium. La página /premium y el modal de downgrade
 * llegan en fases posteriores; acá solo se informa el estado.
 */
export function PremiumStatusCard() {
  const status = useLoad(fetchMyPremiumStatus, []);

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
  const until = formatDate(premiumUntil);
  const graceUntil = formatDate(premiumGraceUntil);

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
    </div>
  );
}
