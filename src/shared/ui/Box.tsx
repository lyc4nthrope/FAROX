import type { ReactNode } from "react";

import { mapError } from "../lib/errors/mapError";

/** Caja simple para agrupar una sección de la pantalla. */
export function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-2xl border border-gray-200/80 bg-white shadow-sm">
      <h2 className="border-b border-gray-100 px-5 py-3 text-sm font-semibold tracking-tight text-gray-900">
        {title}
      </h2>
      <div className="overflow-x-auto p-5">{children}</div>
    </section>
  );
}

/** Mensaje de estado: carga, error (ya mapeado) o éxito. */
export function Status({
  loading,
  error,
  ok,
}: {
  loading?: boolean;
  error?: string | null;
  ok?: string | null;
}) {
  if (loading === true)
    return (
      <p role="status" className="my-2 flex items-center gap-2 text-sm text-gray-500">
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900"
        />
        Cargando…
      </p>
    );
  if (error)
    return (
      <p
        role="alert"
        className="my-2 rounded-xl border border-red-200 border-l-4 border-l-red-500 bg-red-50 px-3 py-2 text-sm text-red-800"
      >
        {error}
      </p>
    );
  if (ok)
    return (
      <p
        role="status"
        className="my-2 rounded-xl border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
      >
        {ok}
      </p>
    );
  return null;
}

/** Fila etiqueta + control, para formularios mínimos. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 flex max-w-md flex-col gap-1.5 text-sm [&>input]:w-full [&>select]:w-full [&>textarea]:w-full">
      <span className="text-xs font-semibold tracking-wide text-gray-600">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-4 focus:ring-gray-900/5 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500";

export const buttonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Ejecuta una mutación y devuelve el texto de error mapeado (o null si fue bien).
 * Atrapa también excepciones de red.
 */
export async function runAction(
  action: () => Promise<{ error: { message: string } | null }>,
): Promise<string | null> {
  try {
    const { error } = await action();
    return error === null ? null : mapError(error);
  } catch (thrown) {
    return mapError(thrown);
  }
}

const BADGE_TONES = {
  gray: "bg-gray-100 text-gray-700 ring-gray-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

/** Etiqueta de estado con color (siempre acompañada de texto, nunca solo color). */
export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Grilla de 2 columnas en pantallas anchas para cajas de formulario. */
export function TwoColumns({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-4 lg:grid-cols-2">{children}</div>;
}
