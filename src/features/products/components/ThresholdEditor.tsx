import { useEffect, useState } from "react";

import { buttonClass } from "../../../shared/ui/Box";

// Umbral de alerta editable desde el inventario unificado (0024). Vacío = sin
// umbral: el RPC set_stock_threshold acepta NULL y limpia el valor anterior.
export function ThresholdEditor({
  productName,
  value,
  saving,
  onSave,
}: {
  productName: string;
  value: number | null;
  saving: boolean;
  onSave: (threshold: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  useEffect(() => {
    setDraft(value === null ? "" : String(value));
  }, [value]);

  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 0);
  const dirty = valid && parsed !== value;

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min="0"
        step="0.001"
        aria-label={`Umbral de ${productName}`}
        placeholder="Sin umbral"
        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm disabled:bg-gray-100"
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        className={buttonClass}
        type="button"
        disabled={saving || !dirty}
        onClick={() => {
          if (valid) onSave(parsed);
        }}
      >
        Guardar
      </button>
    </div>
  );
}
