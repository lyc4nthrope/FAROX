import { Link } from "react-router-dom";

import { useList } from "../../../shared/hooks/useList";
import { Pager } from "../../../shared/ui/Pager";
import { fetchProducts } from "../api";
import { ProductList } from "../components/ProductList";
import type { ProductListRow } from "../types";

// /products para el admin: vista GENERAL. Es el único rol que ve y edita todo
// el registro de productos (S1). Los demás roles tienen su propio catálogo
// (MyCatalogPage).
export function AdminProductsPage() {
  const list = useList<ProductListRow>(fetchProducts);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
      <p className="mt-1 text-sm text-gray-600">
        Catálogo general de la base de datos. Las tiendas y distribuidores eligen de acá los
        productos que manejan.
      </p>
      <Link
        to="/products/new"
        className="mt-4 inline-block rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
      >
        Nuevo producto
      </Link>
      <ProductList rows={list.rows} loading={list.loading} error={list.error} />
      <Pager list={list} />
    </section>
  );
}
