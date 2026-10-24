import type { ReactNode } from "react";

import { mapError } from "../lib/errors/mapError";

/** Caja simple para agrupar una sección de la pantalla. */
export function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 border-b border-gray-100 pb-2 text-base font-semibold text-gray-900">{title}</h2>
      {children}
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
  if (loading === true) return <p role="status" className="my-2 text-sm text-gray-500">Cargando…</p>;
  if (error)
    return (
      <p role="alert" className="my-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
        {error}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="my-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
        {ok}
      </p>
    );
  return null;
}

/** Fila etiqueta + control, para formularios mínimos. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 flex max-w-md flex-col gap-1 text-sm">
      <span className="font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "rounded border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-offset-1 focus:outline-gray-900";
export const buttonClass =
  "min-h-9 rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50";

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
