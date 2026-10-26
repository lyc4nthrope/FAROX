import { useEffect, useState } from "react";

import { useList } from "../../../shared/hooks/useList";
import { fetchUserStoreCounts, fetchUsers } from "../api";
import { UserList } from "../components/UserList";
import type { UserListRow, UserStoreCounts } from "../types";
import { Pager } from "../../../shared/ui/Pager";

// Contenedor de /users (sdd/admin-console T-B4, ADM-3): lista paginada vía
// useList (D4 — 25/página, refetch al re-entrar la ruta, cero realtime) bajo
// el guard RequireRole ADMIN_ONLY del router (ADM-3.3: la denegación ocurre
// ANTES de montar este componente ⇒ acá nunca corre una query sin permiso).
// SIN alta ni baja de usuarios (ADM-3.2 · D3): la baja es is_active.
export function UsersPage() {
  const list = useList<UserListRow>(fetchUsers);
  const [counts, setCounts] = useState<UserStoreCounts | null>(null);

  // FLAG-4: la columna «Tiendas» es una query de APOYO independiente de la
  // lista — si falla (p. ej. sin el GRANT D2a en runtime), la lista no se
  // rompe: la columna degrada a «—». El error crudo acá solo decide el
  // fallback; jamás se renderiza (HARD-1).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchUserStoreCounts();
        if (!cancelled) {
          setCounts(result.counts);
        }
      } catch {
        if (!cancelled) {
          setCounts(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = list.rows.map((row) => ({
    ...row,
    store_count: counts === null ? null : (counts[row.id] ?? 0),
  }));

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Administración
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
        {!list.loading && (
          <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-500">
            {rows.length} {rows.length === 1 ? "usuario" : "usuarios"}
          </span>
        )}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Roles, acceso Premium y alcance de cada persona. La baja se hace desactivando la cuenta.
      </p>
      <UserList rows={rows} loading={list.loading} error={list.error} />
      <Pager list={list} />
    </section>
  );
}
