import { buttonClass, secondaryButtonClass } from "../../../shared/ui/Box";
import type { OrderStatus } from "../api";

/**
 * Acciones de un pedido abierto. Las comparten «Mis pedidos» y las paradas de
 * «Mi ruta»: un solo lugar define textos, orden y estado deshabilitado.
 */
export function OrderActions({
  status,
  busy,
  onInRoute,
  onPending,
  onDeliver,
}: {
  status: OrderStatus;
  busy: boolean;
  onInRoute: () => void;
  onPending: () => void;
  onDeliver: () => void;
}) {
  if (status === "pending") {
    return (
      <button
        className={`${secondaryButtonClass} px-2.5 py-1 text-xs`}
        type="button"
        disabled={busy}
        onClick={onInRoute}
      >
        En ruta
      </button>
    );
  }
  if (status === "in_route") {
    return (
      <span className="inline-flex flex-wrap gap-1.5">
        <button
          className={`${secondaryButtonClass} px-2.5 py-1 text-xs`}
          type="button"
          disabled={busy}
          onClick={onPending}
        >
          Devolver a pendiente
        </button>
        <button
          className={`${buttonClass} px-2.5 py-1 text-xs`}
          type="button"
          disabled={busy}
          onClick={onDeliver}
        >
          Entregar todo
        </button>
      </span>
    );
  }
  return <span className="text-xs text-gray-400">—</span>;
}
