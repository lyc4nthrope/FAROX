import { useCallback, useEffect, useRef, useState } from "react";

import { mapError } from "../lib/errors/mapError";
import { initialListQuery, type ListQuery, type ListResult } from "../lib/list";

// D4 · useList (T3.2 — diseño #486): contenedor genérico de listados, a mano
// (TanStack Query rechazado: dependencia extra para 3 CRUDs — D4).
// Fetch / refetch / mutate→refetch tras mutación exitosa (HARD-3).
// CERO realtime (§S8-4): el refresco es por refetch, jamás por suscripción.
// El hook NO importa supabase: el fetcher es la capa api de la feature (D1).

export type ListFetcher<T> = (query: ListQuery) => Promise<ListResult<T>>;

/**
 * Estado del listado. `error` ya viene MAPEADO por mapError(): el texto
 * crudo del backend no puede salir de este hook (HARD-1).
 */
export interface UseListState<T> {
  rows: T[];
  count: number | null;
  loading: boolean;
  error: string | null;
  query: ListQuery;
}

export interface UseListResult<T> extends UseListState<T> {
  /** Cambia la página y vuelve a pedir (page base-0). */
  setPage: (page: number) => void;
  /** Vuelve a pedir la página actual (tras mutación manual, focus, etc.). */
  refetch: () => void;
  /**
   * Corre una mutación y, si tuvo éxito, refetchea la lista (HARD-3 —
   * sin realtime). El error devuelto queda en manos del caller, que lo
   * muestra pasándolo por mapError().
   */
  mutate: (
    action: () => Promise<{ error: { message: string } | null }>,
  ) => Promise<{ error: { message: string } | null }>;
}

/**
 * @param fetcher función ESTABLE (la exportada del módulo api de la feature)
 *   que ejecuta el select paginado con .range() + count: 'planned' (D4).
 * @param initialQuery consulta inicial; por defecto primera página de 25.
 */
export function useList<T>(
  fetcher: ListFetcher<T>,
  initialQuery: ListQuery = initialListQuery,
): UseListResult<T> {
  const [query, setQuery] = useState<ListQuery>(initialQuery);
  const [rows, setRows] = useState<T[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  // fetcher por ref: un fetcher inline (identidad nueva en cada render) no
  // debe re-disparar el effect — así no hay loop infinito.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await fetcherRef.current(query);
        if (cancelled) return;
        setRows(result.rows);
        setCount(result.count);
        setError(result.error === null ? null : mapError(result.error));
      } catch (thrown) {
        // Sin conexión el fetcher rechaza (supabase-js propaga el TypeError
        // del fetch): se degrada a un mensaje amigable, nunca un crash.
        if (cancelled) return;
        setRows([]);
        setCount(null);
        setError(mapError(thrown));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [query, reloadKey]);

  const refetch = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  const setPage = useCallback((page: number) => {
    setQuery((current) => (current.page === page ? current : { ...current, page }));
  }, []);

  const mutate = useCallback(
    async (action: () => Promise<{ error: { message: string } | null }>) => {
      const result = await action();
      if (result.error === null) {
        refetch(); // HARD-3: refetch tras mutación exitosa (cero realtime)
      }
      return result;
    },
    [refetch],
  );

  return { rows, count, loading, error, query, setPage, refetch, mutate };
}
