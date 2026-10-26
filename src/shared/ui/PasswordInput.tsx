import { useState } from "react";

export interface PasswordInputProps {
  id: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  value: string;
  onChange: (value: string) => void;
  /** Texto del nombre accesible del botón: «Mostrar <revealName>». */
  revealName: string;
  hint?: string;
  error?: string;
}

// Campo de contraseña con visibilidad alternable. El estado de visibilidad es
// local a cada instancia: mostrar la contraseña de login no revela la
// confirmación del registro. Presentacional pura: el valor y los errores los
// gobierna el formulario contenedor (D1).
export function PasswordInput({
  id,
  label,
  autoComplete,
  value,
  onChange,
  revealName,
  hint,
  error,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy =
    [hintId, errorId].filter((value): value is string => value !== undefined).join(" ") ||
    undefined;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <div className="relative mt-1">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          className="w-full rounded border border-gray-300 px-3 py-2 pr-24 text-sm"
          value={value}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${revealName}`}
          className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-gray-600 hover:text-gray-900 focus:outline-2 focus:outline-gray-900"
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-xs text-gray-500">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
