import { useAuth } from "../../../app/providers/AuthProvider";
import { useList } from "../../../shared/hooks/useList";
import { fetchStores, type StoreListScope } from "../api";
import { StoreList } from "../components/StoreList";
import type { StoreListRow } from "../types";

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
  const { role } = useAuth();
  const scope: StoreListScope = role === "operador" ? "mine" : "all";
  const list = useList<StoreListRow>((query) => fetchStores(query, scope));

  return (
    <section>
      <h1 className="text-xl font-semibold">Tiendas</h1>
      <StoreList
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        canCreate={role === "admin" || role === "operador"}
      />
    </section>
  );
}
