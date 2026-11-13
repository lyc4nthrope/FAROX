/**
 * Cantidad de una línea de pedido con − / campo chico / +. El campo admite
 * decimales (numeric(12,3)); los botones suman o restan de a 1 y nunca bajan
 * de 1 unidad (para menos, se escribe a mano).
 */
export function QuantityStepper({
  label,
  value,
  onChange,
  min = 1,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Piso de los botones. En stock 0 es válido; en una línea de pedido no. */
  min?: number;
}) {
  const parsed = Number(value);
  const current = Number.isFinite(parsed) ? parsed : 0;
  const canDecrease = Number.isFinite(parsed) && current > min;
  const inputMin = min <= 0 ? "0" : "0.001";

  function step(delta: number): void {
    const next = Math.max(min, Math.round((current + delta) * 1000) / 1000);
    onChange(String(next));
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-gray-300 bg-white shadow-sm">
      <button
        type="button"
        aria-label={`Restar cantidad de ${label}`}
        className="flex h-8 w-8 items-center justify-center rounded-l-lg text-lg leading-none text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-300"
        disabled={!canDecrease}
        onClick={() => step(-1)}
      >
        −
      </button>
      <input
        aria-label={`Cantidad de ${label}`}
        className="h-8 w-14 border-x border-gray-200 bg-white px-1 text-center text-sm text-gray-900 focus:outline-none"
        type="number"
        min={inputMin}
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        aria-label={`Sumar cantidad de ${label}`}
        className="flex h-8 w-8 items-center justify-center rounded-r-lg text-lg leading-none text-gray-700 transition hover:bg-gray-100"
        onClick={() => step(1)}
      >
        +
      </button>
    </div>
  );
}
