import { useEffect, useState } from "react";

import { mapError } from "../../../shared/lib/errors/mapError";
import { fetchAuditPage } from "../api";
import { AUDITED_TABLES, type AuditedTable } from "../schemas";
import { AuditTable } from "../components/AuditTable";
import type { AuditRow } from "../types";

// Contenedor de /audit (sdd/admin-console T-D2, ADM-10). Bajo el guard
// RequireRole ADMIN_ONLY del router (ADM-10.4/ADM-12.3: la denegación ocurre
// ANTES de montar este componente ⇒ acá nunca corre una query sin permiso).
// Paginación KEYSET por id DESC (decisión #6 del design · FLAG-1): «Cargar
// más» pide la página siguiente con el id de la última fila como cursor.
// NO usa useList (offset + count) — una tabla append-only e infinita no tiene
// total útil y el count es caro (ADM-10.2: el DOM jamás muestra un total).
// SIN controles de escritura: el DML está revocado hasta para el rol de
// servicio (0006:351-357 + 0011:551-554) — read-only también por diseño.
export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // "" = todas las tablas; el select solo emite valores del enum de tablas
  // auditadas (D21) ⇒ un valor inválido es inalcanzable por construcción y,
  // además, la capa api Zod-safeParsa ANTES de tocar la red (defensa en
  // profundidad — cero invocaciones de red con input inválido).
  const [tabla, setTabla] = useState<AuditedTable | "">("");

  // Refetch al montar y ante cada cambio de filtro (HARD-3 sin realtime):
  // la página 1 se pide SIEMPRE sin cursor.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const { rows: datos, hasMore: hayMas, error: fallo } = await fetchAuditPage(
          null,
          tabla === "" ? undefined : tabla,
        );
        if (cancelled) return;
        setRows(datos);
        setHasMore(hayMas);
        setError(fallo === null ? null : mapError(fallo));
      } catch (thrown) {
        if (cancelled) return;
        setRows([]);
        setHasMore(false);
        setError(mapError(thrown));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tabla]);

  // «Cargar más» (keyset): el cursor es el id de la ÚLTIMA fila visible — el
  // server devuelve estrictamente filas por debajo (order id DESC + lt).
  async function cargarMas(): Promise<void> {
    const ultima = rows[rows.length - 1];
    if (ultima === undefined) return;
    setCargandoMas(true);
    try {
      const { rows: datos, hasMore: hayMas, error: fallo } = await fetchAuditPage(
        ultima.id,
        tabla === "" ? undefined : tabla,
      );
      if (fallo !== null) {
        // El error reemplaza la tabla (contrato DataTable): al re-entrar la
        // ruta se pide la página 1 de nuevo (HARD-3, sin estado persistido).
        setError(mapError(fallo));
        return;
      }
      // Dedupe defensivo: si entre página y página entró un evento nuevo en
      // el head, un id repetido no duplica la fila (keys de React incluidas).
      setRows((prev) => {
        const vistas = new Set(prev.map((row) => row.id));
        return [...prev, ...datos.filter((row) => !vistas.has(row.id))];
      });
      setHasMore(hayMas);
    } catch (thrown) {
      setError(mapError(thrown));
    } finally {
      setCargandoMas(false);
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Auditoría</h1>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          Filtrar por tabla
          <select
            value={tabla}
            onChange={(event) => setTabla(event.target.value as AuditedTable | "")}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800"
          >
            <option value="">Todas las tablas</option>
            {AUDITED_TABLES.map((nombre) => (
              <option key={nombre} value={nombre}>
                {nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      <AuditTable
        rows={rows}
        loading={loading}
        error={error}
        hasMore={hasMore}
        cargandoMas={cargandoMas}
        onCargarMas={() => void cargarMas()}
      />
    </section>
  );
}
