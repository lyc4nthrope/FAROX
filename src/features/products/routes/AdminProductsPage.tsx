import { Link } from "react-router-dom";

import { useList } from "../../../shared/hooks/useList";
import { buttonClass } from "../../../shared/ui/Box";
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
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Catálogo</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
            {!list.loading && (
              <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-500">
                {list.rows.length} {list.rows.length === 1 ? "producto" : "productos"}
              </span>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Catálogo general de la base de datos. Las tiendas y distribuidores eligen de acá los
            productos que manejan.
          </p>
        </div>
        <Link className={buttonClass} to="/products/new">
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            viewBox="0 0 24 24"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Nuevo producto
        </Link>
      </div>
      <ProductList rows={list.rows} loading={list.loading} error={list.error} />
      <Pager list={list} />
    </section>
  );
}
