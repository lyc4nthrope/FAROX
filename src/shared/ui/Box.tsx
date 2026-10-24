import type { ReactNode } from "react";

import { mapError } from "../lib/errors/mapError";

/** Caja simple para agrupar una sección de la pantalla. */
export function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded border border-gray-300 p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
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
  if (loading === true) return <p role="status">Cargando…</p>;
  if (error) return <p role="alert" className="text-red-700">{error}</p>;
  if (ok) return <p role="status" className="text-green-700">{ok}</p>;
  return null;
}

/** Fila etiqueta + control, para formularios mínimos. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-2 flex flex-col gap-1 text-sm">
      <span>{label}</span>
      {children}
    </label>
  );
}

export const inputClass = "rounded border border-gray-400 px-2 py-1";
export const buttonClass =
  "rounded border border-gray-500 bg-gray-100 px-3 py-1 text-sm disabled:opacity-50";

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
