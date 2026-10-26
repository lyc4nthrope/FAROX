import { useEffect, useState } from "react";

import { mapError } from "../../../shared/lib/errors/mapError";
import { fetchRoles } from "../api";
import { RoleTable } from "../components/RoleTable";
import type { RoleListRow } from "../types";

// Contenedor de /roles (sdd/admin-console T-C2, ADM-8). Bajo el guard
// RequireRole ADMIN_ONLY del router (ADM-12.3: la denegación ocurre ANTES de
// montar este componente ⇒ acá nunca corre una query sin permiso).
// La tabla roles es acotada por diseño (3 semilla + creaciones del admin):
// se listan TODAS las filas sin paginar (D4) — igual que las queries de
// opciones de otras features. El listado re-pide al re-entrar la ruta
// (HARD-3 sin realtime).
export function RolesPage() {
  const [rows, setRows] = useState<RoleListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { rows: datos, error: fallo } = await fetchRoles();
        if (cancelled) return;
        setRows(datos);
        setError(fallo === null ? null : mapError(fallo));
      } catch (thrown) {
        if (cancelled) return;
        setRows([]);
        setError(mapError(thrown));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Administración
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2.5">
        <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
        {!loading && (
          <span className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-500">
            {rows.length} {rows.length === 1 ? "rol" : "roles"}
          </span>
        )}
      </div>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Los roles del sistema son fijos; podés revisar su descripción y editar los roles propios.
      </p>
      <RoleTable rows={rows} loading={loading} error={error} />
    </section>
  );
}
