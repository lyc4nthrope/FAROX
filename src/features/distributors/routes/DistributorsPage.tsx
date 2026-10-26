import { useEffect, useState } from "react";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useList } from "../../../shared/hooks/useList";
import { fetchDistributorUserCounts, fetchDistributors } from "../api";
import { DistributorList } from "../components/DistributorList";
import type { DistributorListRow, DistributorUserCounts } from "../types";
import { Pager } from "../../../shared/ui/Pager";
import { MyDistributorsPage } from "./MyDistributorsPage";

// El operador (dueño de tienda) ve SUS distribuidores vinculados y el QR para
// vincular uno nuevo; el admin conserva la lista global con CRUD.
export function DistributorsPage() {
  const { role } = useAuth();
  if (role === "operador") return <MyDistributorsPage />;
  return <AdminDistributorsPage />;
}

// Contenedor de /distributors (§S2 fila Distributor list · DIST-01, spec #483
// S4 · idea:218): lista paginada vía useList (D4 — refetch al re-entrar la
// ruta tras una mutación, HARD-3; cero realtime §S8-4) con los controles
// SEC-01 por rol (idea:119: admin escribe · operador solo lectura ·
// distribuidor nunca llega acá: RequireRole lo deniega antes de montar).
function AdminDistributorsPage() {
  const { role } = useAuth();
  const list = useList<DistributorListRow>(fetchDistributors);

  // sdd/admin-console T-E2 (in-scope #5): columna admin «Usuarios asignados».
  // Query de APOYO independiente de la lista (patrón FLAG-4 de UsersPage):
  // UNA sola lectura de users con el conteo por distributor_id en el cliente
  // — sin N+1. Solo admin la dispara (el operador no puede leer users ⇒
  // undefined = la columna no existe); si falla, queda null ⇒ celdas «—».
  const [userCounts, setUserCounts] = useState<
    DistributorUserCounts | null | undefined
  >(role === "admin" ? null : undefined);

  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchDistributorUserCounts();
        if (!cancelled) setUserCounts(result.counts);
      } catch {
        if (!cancelled) setUserCounts(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">Distribuidores</h1>
      <DistributorList
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        canWrite={role === "admin"}
        userCounts={userCounts}
      />
      <Pager list={list} />
    </section>
  );
}
