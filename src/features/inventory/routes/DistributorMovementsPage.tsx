import { useState } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { EmptyState } from "../../../shared/ui";
import { Status, secondaryButtonClass } from "../../../shared/ui/Box";
import { MovementList } from "../components/MovementList";
import { fetchDistributorMovements } from "../api";

type TypeFilter = "all" | "entry" | "exit";

const FILTERS: readonly { id: TypeFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "entry", label: "Entradas" },
  { id: "exit", label: "Salidas" },
];

/**
 * /movimientos del distribuidor: el mismo lenguaje visual que la pestaña de
 * movimientos del operador (MovementList), con la tienda de cada movimiento.
 * Solo lectura: el distribuidor no ajusta stock.
 */
export function DistributorMovementsPage() {
  const movements = useLoad(fetchDistributorMovements, []);
  const [type, setType] = useState<TypeFilter>("all");
  const rows = (movements.data ?? []).filter(
    (movement) => type === "all" || movement.type === type,
  );
  const empty = (movements.data ?? []).length === 0;

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Movimientos
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Movimientos</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Entradas y salidas de tus entregas a las tiendas. Es un historial de solo lectura.
      </p>

      <div className="mt-5 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="group"
            aria-label="Tipo de movimiento"
            className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1"
          >
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={type === filter.id}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  type === filter.id
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
                onClick={() => setType(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <span className="text-xs font-medium text-gray-500">
            {rows.length} {rows.length === 1 ? "movimiento" : "movimientos"}
          </span>
        </div>

        <Status loading={movements.loading} error={movements.error} />
        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title={empty ? "Todavía no hay movimientos" : "No hay movimientos de este tipo"}
              hint={
                empty
                  ? "Las entregas que confirmes van a aparecer acá."
                  : "Probá con otro filtro."
              }
            />
          </div>
        ) : (
          <MovementList movements={rows} showStore />
        )}
        {rows.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
              type="button"
              onClick={() => movements.reload()}
            >
              Actualizar
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
