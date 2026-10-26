import { useAuth } from "../../../app/providers/AuthProvider";
import { useList } from "../../../shared/hooks/useList";
import { STORE_CAP_MESSAGE } from "../../../shared/lib/errors/mapError";
import { fetchStores, type StoreListScope } from "../api";
import { StoreList } from "../components/StoreList";
import type { StoreListRow } from "../types";
import { Pager } from "../../../shared/ui/Pager";

// Contenedor de /stores (§S2 fila Store list · STORE-2, spec #483 S6 ·
// idea:68/207 CRUD de Tiendas): lista paginada vía useList (D4 — refetch al
// re-entrar la ruta tras una mutación, HARD-3; cero realtime §S8-4).
//
// SCOPE de la lista (§S2 "admin all · operador own"): stores_select es USING
// true (0006:164-165) — la DB NO scopea el SELECT —, así que el alcance del
// operador se pide a la fuente canónica my_store_ids() y la capa api lo
// aplica como filtro del query (escenarios STORE-2 "empty scope list" e
// HITO-1 "operador ve solo su alcance"). Es UX, no seguridad (idea:134): la
// escritura la siguen gateando stores_update/stores_delete en la DB.
// El scope es estable por mount porque la ruta /stores está envuelta en
// RequireRole: el rol ya resolvió antes de montar este contenedor.
export function StoresPage() {
  const { role, premium } = useAuth();
  const scope: StoreListScope = role === "operador" ? "mine" : "all";
  const list = useList<StoreListRow>((query) => fetchStores(query, scope));

  // sdd/admin-console T-E2 (in-scope #5 de la propuesta): hint proactivo del
  // tope D34 con gate premium D7 — is_premium() = premium OR admin
  // (0004:39-48), así que solo la sesión SIN premium y SIN rol admin está
  // sujeta al cap (1 activa) y ve el copy. El mensaje sale de mapError.ts
  // (STORE_CAP_MESSAGE): misma string que vería si el server levanta el
  // RAISE — sin duplicar copy.
  const sujetaAlTope = !premium && role !== "admin";

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Red</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tiendas</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Tus tiendas, su ubicación y el estado de cada una. Desde acá entrás al inventario y al QR de
        vínculo.
      </p>
      {sujetaAlTope && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200/80 bg-gradient-to-b from-amber-50/70 to-white p-3.5 shadow-sm">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 ring-1 ring-inset ring-amber-200">
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <rect height="11" rx="2" width="16" x="4" y="10" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-amber-800">
              Límite del plan
              <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-amber-800">
                Premium
              </span>
            </p>
            <p className="mt-1 text-sm text-gray-700">{STORE_CAP_MESSAGE}</p>
          </div>
        </div>
      )}
      <StoreList
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        canCreate={role === "admin" || role === "operador"}
      />
      <Pager list={list} />
    </section>
  );
}
