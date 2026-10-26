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
      className="mt-4 overflow-hidden rounded-lg border border-amber-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <svg
          aria-label="Bloqueado"
          className="h-5 w-5 text-amber-600"
          fill="none"
          role="img"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <rect height="11" rx="2" width="16" x="4" y="10" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          Premium
        </span>
      </div>

      <p className="mt-2 text-sm text-gray-700">Con Premium podés:</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
        {benefits.map((benefit) => (
          <li key={benefit}>{benefit}</li>
        ))}
      </ul>

      {preview !== undefined && (
        <div aria-hidden="true" className="pointer-events-none mt-3 select-none opacity-70">
          {preview}
        </div>
      )}

      {children !== undefined && (
        <fieldset className="mt-3 opacity-60" disabled>
          {children}
        </fieldset>
      )}

      <p className="mt-3 text-xs text-gray-500">
        Un administrador activa Premium desde Usuarios → detalle del usuario.
      </p>
    </section>
  );
}
