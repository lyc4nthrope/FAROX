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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
      </div>
      <RoleTable rows={rows} loading={loading} error={error} />
    </section>
  );
}
