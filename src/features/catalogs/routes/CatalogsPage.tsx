import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { CATALOG_DEFINITIONS } from "../definitions";

const DESCRIPTIONS: Record<string, string> = {
  unit_types: "Cómo se mide cada producto: kilos, litros, unidades.",
  store_types: "Miscelánea, ferretería, tienda de barrio y más.",
  brands: "Fabricantes y proveedores que firman el catálogo.",
  product_categories: "La organización jerárquica de todos los productos.",
};

const ICONS: Record<string, ReactNode> = {
  unit_types: (
    <>
      <path d="M4 6h16M4 12h10M4 18h7" />
    </>
  ),
  store_types: (
    <>
      <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" />
      <path d="m3 9 1.6-4.4A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.6L21 9M9 20v-5h6v5" />
    </>
  ),
  brands: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </>
  ),
  product_categories: (
    <>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="m4 7 8 4 8-4M12 11v10" />
    </>
  ),
};

// Contenedor liviano de /catalogs (sdd/admin-console T-C5, design
// key-decision #4): UNA entrada de nav que abre un índice con las 4
// pantallas del motor (D-M1). Sin queries: las policies de lectura son
// USING(true), pero el índice no necesita datos — solo los links.
export function CatalogsPage() {
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Configuración
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Catálogos</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Cada catálogo se lista completo; crear, editar y borrar es solo para administradores.
      </p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {CATALOG_DEFINITIONS.map((definition) => (
          <li key={definition.key}>
            <Link
              to={`/catalogs/${definition.key}`}
              aria-label={definition.label}
              className="group flex h-full items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition group-hover:bg-gray-900 group-hover:text-white">
                <svg
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  {ICONS[definition.key] ?? <path d="M5 12h14m-6-6 6 6-6 6" />}
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">{definition.label}</span>
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-900"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M5 12h14m-6-6 6 6-6 6" />
                  </svg>
                </span>
                <span className="mt-1 block text-[13px] leading-snug text-gray-500">
                  {DESCRIPTIONS[definition.key] ?? ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
