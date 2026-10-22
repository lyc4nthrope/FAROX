import { ROLE_NAMES } from "../../auth/types";
import type { RoleFormState } from "../schemas";

export interface RoleFormErrors {
  name?: string;
  description?: string;
}

interface RoleFormProps {
  values: RoleFormState;
  errors: RoleFormErrors;
  formError: string | null;
  notice: string | null;
  saving: boolean;
  /** Edición de un rol semilla: el nombre queda deshabilitado (ADM-8.5). */
  nombreDeshabilitado: boolean;
  /** Solo el borrado de un rol NO semilla existe en la UI (ADM-8.5). */
  onDelete?: () => void;
  onChange: (next: RoleFormState) => void;
  onSubmit: () => void;
}

// Presentacional pura (D1) · sdd/admin-console T-C3 (ADM-8): form de rol
// con LA salvaguarda R3 a la vista. El name se valida contra ROLE_NAMES en
// el contenedor (Zod ANTES de cualquier request); el copy de la guarda vive
// acá, siempre visible junto al campo (ADM-8.2).
export function RoleForm({
  values,
  errors,
  formError,
  notice,
  saving,
  nombreDeshabilitado,
  onDelete,
  onChange,
  onSubmit,
}: RoleFormProps) {
  return (
    <form
      noValidate
      className="mt-3 space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {formError !== null && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {formError}
        </p>
      )}
      {notice !== null && (
        <p
          role="status"
          className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
        >
          {notice}
        </p>
      )}
      <div>
        <label
          htmlFor="role-name"
          className="block text-sm font-medium text-gray-700"
        >
          Nombre del rol
        </label>
        <input
          id="role-name"
          type="text"
          disabled={nombreDeshabilitado}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-500"
          value={values.name}
          aria-invalid={errors.name !== undefined}
          aria-describedby={
            errors.name === undefined
              ? "role-name-hint"
              : "role-name-hint role-name-error"
          }
          onChange={(event) => onChange({ ...values, name: event.target.value })}
        />
        {/* Mitigación R3 (ADM-8.2): la UI no puede crear nombres fuera del
            catálogo de la app — «superuser» se bloquea con CERO requests y
            este copy explica por qué. */}
        <p id="role-name-hint" className="mt-1 text-xs text-gray-500">
          Para crear un rol nuevo hay que actualizar el catálogo de la app
          primero. Válidos: {ROLE_NAMES.join(", ")}.
        </p>
        {errors.name !== undefined && (
          <p id="role-name-error" className="mt-1 text-xs text-red-600">
            {errors.name}
          </p>
        )}
        {nombreDeshabilitado && (
          <p className="mt-1 text-xs text-gray-500">
            Los roles del catálogo de la app no se pueden renombrar.
          </p>
        )}
      </div>
      <div>
        <label
          htmlFor="role-description"
          className="block text-sm font-medium text-gray-700"
        >
          Descripción
        </label>
        <textarea
          id="role-description"
          rows={3}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
          value={values.description}
          aria-invalid={errors.description !== undefined}
          aria-describedby={
            errors.description === undefined
              ? undefined
              : "role-description-error"
          }
          onChange={(event) =>
            onChange({ ...values, description: event.target.value })
          }
        />
        {errors.description !== undefined && (
          <p id="role-description-error" className="mt-1 text-xs text-red-600">
            {errors.description}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
        {onDelete !== undefined && (
          <button
            type="button"
            disabled={saving}
            onClick={onDelete}
            className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Eliminar rol
          </button>
        )}
      </div>
    </form>
  );
}
