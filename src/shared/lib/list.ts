// D4 · contrato de listados paginados (T3.2 — diseño #486, spec #483).
// count: 'planned' JAMÁS 'exact' (costo — Base:695); página de 25; cero realtime
// (la publicación solo cubre alerts/dashboard_daily, ambos diferidos §S8-2).
// shared/lib NO importa React (convención del repo): este módulo es puro.

/** Tamaño de página fijo por diseño (D4). */
export const PAGE_SIZE = 25;

export interface ListQuery {
  /** Página base-0. */
  page: number;
  pageSize: number;
}

/** Consulta inicial de todo listado: primera página. */
export const initialListQuery: ListQuery = { page: 0, pageSize: PAGE_SIZE };

/** Rango [from, to] inclusivo para .range() de PostgREST. */
export function pageRange(query: ListQuery): { from: number; to: number } {
  const from = query.page * query.pageSize;
  return { from, to: from + query.pageSize - 1 };
}

/**
 * Resultado tipado de un listado. `error` es el error del backend SIN tocar
 * (crudo): quien lo renderiza DEBE pasarlo por mapError(). El hook useList ya
 * lo hace para el estado de lista — allí nunca hay texto crudo (HARD-1).
 */
export interface ListResult<T> {
  rows: T[];
  count: number | null;
  error: { message: string } | null;
}
