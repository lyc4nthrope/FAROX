// Presentacional pura (D1): banner de error de listado. `message` SIEMPRE
// viene mapeado por mapError() (HARD-1) — este componente jamás toca el
// backend ni muestra texto crudo.
export interface ErrorBannerProps {
  message: string;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <p
      role="alert"
      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {message}
    </p>
  );
}
