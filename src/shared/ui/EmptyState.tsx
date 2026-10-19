// Presentacional pura (D1): estado vacío de un listado. Vacío NO es error
// (D4: error===null && rows===0 ⇒ EmptyState; el error va a ErrorBanner).
export interface EmptyStateProps {
  title: string;
  hint?: string;
}

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <section
      role="status"
      className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-gray-700"
    >
      <p className="text-sm font-medium">{title}</p>
      {hint !== undefined && <p className="mt-1 text-sm text-gray-500">{hint}</p>}
    </section>
  );
}
