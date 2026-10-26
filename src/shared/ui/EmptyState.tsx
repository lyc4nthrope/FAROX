// Presentacional pura (D1): estado vacío de un listado. Vacío NO es error
// (D4: error===null && rows===0 → EmptyState; el error va a ErrorBanner).
export interface EmptyStateProps {
  title: string;
  hint?: string;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <section
      role="status"
      className="rounded-2xl border border-dashed border-gray-300 bg-white/70 p-8 text-center"
    >
      <span
        aria-hidden="true"
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-gray-100 text-gray-500"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          viewBox="0 0 24 24"
        >
          <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z" />
          <path d="M4 7.5 12 11l8-3.5M12 11v9" />
        </svg>
      </span>
      <p className="mt-3 text-sm font-medium text-gray-800">{title}</p>
      {hint !== undefined && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
    </section>
  );
}
