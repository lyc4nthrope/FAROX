// Una sola forma de mostrar «Premium» en toda la app. Antes había cuatro
// variantes con tamaños, bordes y colores distintos que se desviaban entre sí.
export interface PremiumBadgeProps {
  tone?: "soft" | "outline" | "onDark";
  size?: "sm" | "md";
  /** En móvil deja solo la estrella (con nombre accesible) para ahorrar ancho. */
  hideLabelOnMobile?: boolean;
}

const TONES = {
  soft: "border-amber-200 bg-amber-50 text-amber-800",
  outline: "border-amber-200 bg-white text-amber-800 shadow-sm",
  onDark: "border-amber-300/40 bg-amber-300/15 text-amber-200",
} as const;

const SIZES = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-[11px]",
} as const;

export function PremiumBadge({
  tone = "soft",
  size = "md",
  hideLabelOnMobile = false,
}: PremiumBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold normal-case tracking-normal ${TONES[tone]} ${SIZES[size]}`}
    >
      <svg aria-hidden="true" className="h-3 w-3 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2.5 14.6 9l6.9.5-5.3 4.5 1.7 6.7-5.9-3.6-5.9 3.6 1.7-6.7L2.5 9.5 9.4 9 12 2.5Z" />
      </svg>
      <span className={hideLabelOnMobile ? "sr-only sm:not-sr-only" : undefined}>Premium</span>
    </span>
  );
}
