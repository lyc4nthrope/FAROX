import { useState } from "react";

import { formatCOP } from "../../../shared/lib/format";
import { Field, Status, buttonClass, inputClass } from "../../../shared/ui/Box";

// 0045 — margen de ganancia sobre el costo. Se guarda por RPC (no por UPDATE
// directo: la columna está fuera del grant de perfil). Un valor vacío borra el
// margen y desactiva el precio de venta sugerido.

const EXAMPLE_COST = 10000;

function parseMargin(raw: string): number | null | "invalid" {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 1000) return "invalid";
  // La columna es numeric(6,2): el valor guardado y el mostrado deben coincidir.
  return Math.round(value * 100) / 100;
}

export function MarginCard({
  initial,
  onSave,
}: {
  initial: number | null;
  /** Devuelve el error ya mapeado, o null si guardó. */
  onSave: (margin: number | null) => Promise<string | null>;
}) {
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const parsed = parseMargin(value);
  const example =
    parsed !== null && parsed !== "invalid" && parsed > 0
      ? Math.round(EXAMPLE_COST * (1 + parsed / 100))
      : null;

  async function save(): Promise<void> {
    if (parsed === "invalid") {
      setError("El margen debe estar entre 0 y 1000.");
      setNotice(null);
      return;
    }
    setSaving(true);
    try {
      const failure = await onSave(parsed);
      if (failure !== null) {
        setError(failure);
        setNotice(null);
        return;
      }
      setError(null);
      setNotice(parsed === null ? "Margen quitado." : `Margen guardado: ${parsed}%.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-gray-600">
        Cuánto querés ganar sobre lo que comprás. Se usa para sugerir el precio de venta de los
        productos que todavía no tienen uno.
      </p>
      <p className="mb-3 text-xs text-gray-500">
        El porcentaje no incluye impuestos, envíos ni otros costos.
      </p>
      <Field label="Ganancia sobre el costo (%)">
        <input
          className={inputClass}
          type="number"
          inputMode="decimal"
          min="0"
          max="1000"
          step="0.01"
          placeholder="Ej.: 50"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
            setNotice(null);
          }}
        />
      </Field>
      <p className="mt-1 text-xs text-gray-500" role="status">
        {example === null
          ? "Sin margen: no se sugiere precio de venta automáticamente."
          : `Ejemplo: comprás a ${formatCOP(EXAMPLE_COST)} y vendés a ${formatCOP(example)}.`}
      </p>
      <Status error={error} ok={notice} />
      <button
        className={`${buttonClass} w-full sm:w-auto`}
        type="button"
        onClick={() => void save()}
        disabled={saving}
      >
        {saving ? "Guardando…" : "Guardar margen"}
      </button>
    </div>
  );
}
