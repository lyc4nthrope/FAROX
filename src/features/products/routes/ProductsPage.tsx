import { useAuth } from "../../../app/providers/AuthProvider";
import { useList } from "../../../shared/hooks/useList";
import { fetchProducts } from "../api";
import { ProductList } from "../components/ProductList";
import type { ProductListRow } from "../types";

// Contenedor de /products (§S2 fila Product list · PROD-1, spec #483 S5 ·
// idea:206 CRUD de Productos): lista paginada vía useList (D4 — refetch al
// re-entrar la ruta tras una mutación, HARD-3; cero realtime §S8-4) con los
// controles SEC-01 por rol (idea:113: admin y operador crean · distribuidor
// solo lee el catálogo). La lectura NO se gatea: products_select es USING
// true (0006:144-145) — todos los roles leen.
export function ProductsPage() {
  const { role } = useAuth();
  const list = useList<ProductListRow>(fetchProducts);

  return (
    <section>
      <h1 className="text-xl font-semibold">Productos</h1>
      <ProductList
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        canCreate={role === "admin" || role === "operador"}
      />
    </section>
  );
}
