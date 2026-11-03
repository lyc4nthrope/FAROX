import type { ReactNode } from "react";

import { formatCOP, formatQty } from "../../../shared/lib/format";
import { Badge, secondaryButtonClass } from "../../../shared/ui/Box";
import type { MovementRow } from "../api";

const MOVEMENT_TONES = {
  entry: {
    border: "border-l-emerald-500",
    background: "bg-emerald-50/40",
    icon: "bg-emerald-100 text-emerald-700",
    quantity: "text-emerald-700",
    badge: "green" as const,
    label: "Entrada",
  },
  exit: {
    border: "border-l-sky-500",
    background: "bg-sky-50/40",
    icon: "bg-sky-100 text-sky-700",
    quantity: "text-sky-700",
    badge: "blue" as const,
    label: "Salida",
  },
  reverse: {
    border: "border-l-amber-500",
    background: "bg-amber-50/40",
    icon: "bg-amber-100 text-amber-700",
    quantity: "text-amber-700",
    badge: "amber" as const,
    label: "Reverso",
  },
};

function movementTone(movement: MovementRow): keyof typeof MOVEMENT_TONES {
  if (movement.reverso_of_id !== null) return "reverse";
  return movement.direction ?? movement.type;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

function movementIcon(tone: keyof typeof MOVEMENT_TONES): ReactNode {
  if (tone === "entry") {
    return (
      <Icon>
        <path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14" />
      </Icon>
    );
  }
  if (tone === "exit") {
    return (
      <Icon>
        <path d="M12 20V8m0 0 5 5m-5-5-5 5M5 4h14" />
      </Icon>
    );
  }
  return (
    <Icon>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Icon>
  );
}

/**
 * Lista de movimientos compartida por Inventario (operador) y Movimientos
 * (distribuidor). El distribuidor ve además la tienda de cada movimiento.
 */
export function MovementList({
  movements,
  showStore = false,
  showPrice = true,
  canReverse = false,
  busy = false,
  onReverse,
}: {
  movements: readonly MovementRow[];
  showStore?: boolean;
  showPrice?: boolean;
  canReverse?: boolean;
  busy?: boolean;
  onReverse?: (movement: MovementRow) => void;
}) {
  const reversed = new Set(
    movements.map((movement) => movement.reverso_of_id).filter((id): id is number => id !== null),
  );

  return (
    <ul className="mt-3 space-y-2">
      {movements.map((movement) => {
        const toneKey = movementTone(movement);
        const tone = MOVEMENT_TONES[toneKey];
        const direction = movement.direction ?? movement.type;
        return (
          <li
            key={`${movement.source ?? "movement"}-${movement.id}`}
            data-tone={toneKey}
            className={`flex flex-wrap items-start gap-3 rounded-r-xl border-y border-r border-y-gray-200 border-r-gray-200 border-l-4 px-3 py-3 ${tone.border} ${tone.background}`}
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}
            >
              {movementIcon(toneKey)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 truncate text-sm font-medium text-gray-900">
                  {movement.product_name}
                </p>
                <p className={`text-sm font-semibold tabular-nums ${tone.quantity}`}>
                  {direction === "entry" ? "+" : "−"}
                  {formatQty(movement.quantity)}
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <Badge tone={tone.badge}>{tone.label}</Badge>
                {showStore && movement.store_name !== null && movement.store_name !== undefined && (
                  <>
                    <span className="font-medium text-gray-700">{movement.store_name}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                <span>{new Date(movement.created_at).toLocaleString("es-CO")}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {movement.reverso_of_id === null
                    ? movement.motive_name
                    : `Reverso de #${movement.reverso_of_id}`}
                </span>
                {showPrice &&
                  movement.unit_price !== null &&
                  movement.unit_price !== undefined && (
                  <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        Precio: {formatCOP(movement.unit_price)}
                      </span>
                    </>
                  )}
                {movement.discount_pct !== null && movement.discount_pct !== undefined && (
                  <Badge tone="amber">Desc. {movement.discount_pct}%</Badge>
                )}
                {reversed.has(movement.id) && <Badge tone="amber">Revertido</Badge>}
              </div>
            </div>
            {canReverse &&
              onReverse !== undefined &&
              movement.reverso_of_id === null &&
              !reversed.has(movement.id) && (
                <button
                  type="button"
                  className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
                  disabled={busy}
                  onClick={() => onReverse(movement)}
                >
                  Revertir
                </button>
              )}
          </li>
        );
      })}
    </ul>
  );
}
