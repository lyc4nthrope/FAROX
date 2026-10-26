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
    <nav
      aria-label="Paginación"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm"
    >
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={page === 0 || list.loading}
        onClick={() => list.setPage(page - 1)}
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Anterior
      </button>
      <span className="text-xs font-medium text-gray-500">
        Página {page + 1}
        {total !== null && ` de ~${total}`}
      </span>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!hasNext || list.loading}
        onClick={() => list.setPage(page + 1)}
      >
        Siguiente
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
    </nav>
  );
}
