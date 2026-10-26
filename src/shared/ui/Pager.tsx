/**
 * Paginación para listas de useList (C0.1). "Siguiente" se habilita cuando la
 * página vino llena: no depende del count 'planned', que es una estimación.
 */
export function Pager({
  list,
}: {
  list: {
    rows: unknown[];
    count: number | null;
    loading: boolean;
    query: { page: number; pageSize: number };
    setPage: (page: number) => void;
  };
}) {
  const { page, pageSize } = list.query;
  const hasNext = list.rows.length === pageSize;
  if (page === 0 && !hasNext) return null;
  const total = list.count === null ? null : Math.max(1, Math.ceil(list.count / pageSize));
  return (
    <nav aria-label="Paginación" className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <button
        type="button"
        className="rounded border border-gray-500 bg-gray-100 px-3 py-1 disabled:opacity-50"
        disabled={page === 0 || list.loading}
        onClick={() => list.setPage(page - 1)}
      >
        Anterior
      </button>
      <span>
        Página {page + 1}
        {total !== null && ` de ~${total}`}
      </span>
      <button
        type="button"
        className="rounded border border-gray-500 bg-gray-100 px-3 py-1 disabled:opacity-50"
        disabled={!hasNext || list.loading}
        onClick={() => list.setPage(page + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}
