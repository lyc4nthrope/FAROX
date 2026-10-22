import { Link } from "react-router-dom";

import { CATALOG_DEFINITIONS } from "../definitions";

// Contenedor liviano de /catalogs (sdd/admin-console T-C5, design
// key-decision #4): UNA entrada de nav que abre un índice con las 4
// pantallas del motor (D-M1). Sin queries: las policies de lectura son
// USING(true), pero el índice no necesita datos — solo los links.
export function CatalogsPage() {
  return (
    <section>
      <h1 className="text-xl font-semibold">Catálogos</h1>
      <p className="mt-2 text-sm text-gray-600">
        Cada catálogo se lista completo; crear, editar y borrar es solo para
        administradores.
      </p>
      <ul className="mt-4 space-y-2">
        {CATALOG_DEFINITIONS.map((definition) => (
          <li key={definition.key}>
            <Link
              to={`/catalogs/${definition.key}`}
              className="text-gray-900 underline"
            >
              {definition.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
