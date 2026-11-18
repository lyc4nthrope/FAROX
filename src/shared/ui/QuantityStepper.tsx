/**
 * Cantidad de una línea con − / campo chico / +. Los productos por unidad
 * (0059) solo aceptan enteros; los de granel conservan decimales
 * (numeric(12,3)). Los botones suman o restan de a 1 y nunca bajan del piso
 * indicado (para menos, se escribe a mano).
 */
export function QuantityStepper({
  label,
  value,
  onChange,
  min = 1,
  integer = false,
  unit = null,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Piso de los botones. En stock 0 es válido; en una línea de pedido no. */
  min?: number;
  /** 0059: true = producto por unidad o paquete (sin decimales). */
  integer?: boolean;
  /** Abreviatura visible: und, kg, L. */
  unit?: string | null;
}) {
  const parsed = Number(value);
  const current = Number.isFinite(parsed) ? parsed : 0;
  const canDecrease = Number.isFinite(parsed) && current > min;
  const inputMin = min <= 0 ? "0" : integer ? "1" : "0.001";

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
        inputMode={integer ? "numeric" : "decimal"}
        min={inputMin}
        step={integer ? "1" : "any"}
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
      {unit !== null && unit !== "" && (
        <span className="px-2 text-xs font-medium text-gray-500">{unit}</span>
      )}
    </div>
  );
}
