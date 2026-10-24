import { useCallback, useEffect, useRef, useState } from "react";

import { mapError } from "../lib/errors/mapError";

export interface LoadResult<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface UseLoadState<T> {
  data: T | null;
  /** Ya traducido por mapError(): nunca texto crudo del backend. */
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Carga simple (no paginada) para pantallas de detalle o listas cortas.
 * Descarta respuestas viejas si `deps` cambian antes de que termine la anterior.
 */
export function useLoad<T>(
  loader: () => Promise<LoadResult<T>>,
  deps: readonly unknown[],
): UseLoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await loaderRef.current();
        if (cancelled) return;
        setData(result.data);
        setError(result.error === null ? null : mapError(result.error));
      } catch (thrown) {
        if (cancelled) return;
        setData(null);
        setError(mapError(thrown));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps los define el caller
  }, [...deps, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, error, loading, reload };
}
