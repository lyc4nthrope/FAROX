import type { ReactNode } from "react";

export interface PremiumLockProps {
  title: string;
  /** Lo que desbloquea Premium, en frases cortas y concretas. */
  benefits: readonly string[];
  /** Vista previa decorativa: se muestra atenuada detrás del candado. */
  preview?: ReactNode;
  /** UI real que queda inutilizable mientras no haya Premium. */
  children?: ReactNode;
}

// S5: una acción Premium no se esconde ni se apaga en silencio: se muestra
// bloqueada, con el candado, lo que desbloquea y una vista previa para que se
// entienda el valor. La activación es manual (un admin desde Usuarios), así
// que no existe un CTA de compra: el pie lo dice con todas las letras.
export function PremiumLock({ title, benefits, preview, children }: PremiumLockProps) {
  return (
    <section
      aria-label={`${title} (Premium)`}
      className="mt-4 overflow-hidden rounded-2xl border border-amber-200/80 bg-white shadow-sm"
    >
      <div className="h-1 bg-gradient-to-r from-amber-300 via-amber-500 to-amber-300" />
      <div className="relative bg-gradient-to-b from-amber-50/60 via-white to-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 ring-1 ring-inset ring-amber-200">
            <svg
              aria-label="Bloqueado"
              className="h-5 w-5 text-amber-700"
              fill="none"
              role="img"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <rect height="11" rx="2" width="16" x="4" y="10" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-gray-900">{title}</h2>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-amber-700/80">
              Función Premium
            </p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 shadow-sm before:h-1.5 before:w-1.5 before:rounded-full before:bg-amber-500 before:content-['']">
            Premium
          </span>
        </div>

        <p className="mt-5 text-sm font-medium text-gray-900">Con Premium podés:</p>
        <ul className="mt-2 grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
          {benefits.map((benefit) => (
            <li
              key={benefit}
              className="flex items-start gap-2 rounded-lg border border-amber-100 bg-white/80 px-3 py-2"
            >
              <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 before:h-1.5 before:w-2.5 before:-translate-y-px before:-rotate-45 before:border-b-2 before:border-l-2 before:border-emerald-600 before:content-['']" />
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        {preview !== undefined && (
          <div className="relative mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">
              Vista previa
            </p>
            <div
              aria-hidden="true"
              className="pointer-events-none relative mt-2 select-none opacity-80"
            >
              <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-inner">
                {preview}
              </div>
              <div className="absolute inset-x-0 bottom-0 h-14 rounded-b-xl bg-gradient-to-t from-white to-transparent" />
            </div>
          </div>
        )}

        {children !== undefined && (
          <fieldset
            className="mt-4 rounded-xl border border-dashed border-gray-200 p-3 opacity-60"
            disabled
          >
            {children}
          </fieldset>
        )}

        <p className="mt-4 flex items-start gap-2 text-xs text-gray-500">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold text-gray-500"
          >
            i
          </span>
          Un administrador activa Premium desde Usuarios → detalle del usuario.
        </p>
      </div>
    </section>
  );
}
