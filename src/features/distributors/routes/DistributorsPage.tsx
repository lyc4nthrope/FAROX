import { useAuth } from "../../../app/providers/AuthProvider";
import { useList } from "../../../shared/hooks/useList";
import { fetchDistributors } from "../api";
import { DistributorList } from "../components/DistributorList";
import type { DistributorListRow } from "../types";

// Contenedor de /distributors (§S2 fila Distributor list · DIST-01, spec #483
// S4 · idea:218): lista paginada vía useList (D4 — refetch al re-entrar la
// ruta tras una mutación, HARD-3; cero realtime §S8-4) con los controles
// SEC-01 por rol (idea:119: admin escribe · operador solo lectura ·
// distribuidor nunca llega acá: RequireRole lo deniega antes de montar).
export function DistributorsPage() {
  const { role } = useAuth();
  const list = useList<DistributorListRow>(fetchDistributors);

  return (
    <section>
      <h1 className="text-xl font-semibold">Distribuidores</h1>
      <DistributorList
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        canWrite={role === "admin"}
      />
    </section>
  );
}
