import { useEffect, useState } from "react";

import { buttonClass } from "../../../shared/ui/Box";

// Edición de la cantidad en stock SIN movimiento (S4). El valor vive en un
// input controlado para que el usuario pueda escribir "1.5" sin que el
// refetch pise cada tecla; se re-sincroniza cuando el servidor confirma.
// 0059: los productos por unidad solo aceptan enteros; los de granel, peso o
// volumen libre (hasta 3 decimales).
export function QuantityEditor({
  productName,
  value,
  saving,
  disabled = false,
  isBulk = false,
  unit = null,
  onSave,
}: {
  productName: string;
  value: number;
  saving: boolean;
  disabled?: boolean;
  isBulk?: boolean;
  unit?: string | null;
  onSave: (quantity: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const parsed = Number(draft);
  const valid =
    draft.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed >= 0 &&
    (isBulk || Number.isInteger(parsed));
  const dirty = valid && parsed !== value;

  function handleChange(next: string): void {
    setDraft(next);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min="0"
        step={isBulk ? "0.001" : "1"}
        inputMode={isBulk ? "decimal" : "numeric"}
        aria-label={`Cantidad de ${productName}`}
        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100"
        value={draft}
        disabled={disabled || saving}
        onChange={(event) => handleChange(event.target.value)}
      />
      {unit !== null && unit !== "" && (
        <span className="text-xs font-medium text-gray-500">{unit}</span>
      )}
      <button
        className={buttonClass}
        type="button"
        disabled={disabled || saving || !dirty}
        onClick={() => {
          if (valid) onSave(parsed);
        }}
      >
        Guardar
      </button>
    </div>
  );
}
