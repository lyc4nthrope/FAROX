import type { CatalogDefinition } from "../definitions";
import type { CatalogFormErrors, CatalogFormValues } from "../schemas";
import type { ParentOption } from "../types";

interface CatalogFormProps {
  definition: CatalogDefinition;
  values: CatalogFormValues;
  errors: CatalogFormErrors;
  formError: string | null;
  saving: boolean;
  /** Opciones del picker «categoría padre» (solo product_categories). */
  parentOptions: ParentOption[];
  onCancelEdit?: () => void;
  onChange: (next: CatalogFormValues) => void;
  onSubmit: () => void;
}

// Presentacional pura (D1) · sdd/admin-console T-C4: form genérico del
// motor de catálogos. Los campos salen de definition.fields — el mismo
// componente sirve a las 4 tablas (D-M1). La validación Zod vive en el
// contenedor y corre ANTES de cualquier request (ADM-9.5 ⇒ cero red).
export function CatalogForm({
  definition,
  values,
  errors,
  formError,
  saving,
  parentOptions,
  onCancelEdit,
  onChange,
  onSubmit,
}: CatalogFormProps) {
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
      {definition.fields.map((field) => {
        const id = `catalog-field-${field.key}`;
        const errorId = `${id}-error`;
        const describedBy = errors[field.key] === undefined ? undefined : errorId;
        return (
          <div key={field.key}>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700">
              {field.label}
            </label>
            {field.kind === "textarea" ? (
              <textarea
                id={id}
                rows={3}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={values[field.key] ?? ""}
                aria-invalid={errors[field.key] !== undefined}
                aria-describedby={describedBy}
                onChange={(event) =>
                  onChange({ ...values, [field.key]: event.target.value })
                }
              />
            ) : field.kind === "parent" ? (
              <select
                id={id}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={values[field.key] ?? ""}
                aria-invalid={errors[field.key] !== undefined}
                aria-describedby={describedBy}
                onChange={(event) =>
                  onChange({ ...values, [field.key]: event.target.value })
                }
              >
                <option value="">Sin categoría padre</option>
                {parentOptions.map((option) => (
                  <option key={option.id} value={String(option.id)}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type="text"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={values[field.key] ?? ""}
                aria-invalid={errors[field.key] !== undefined}
                aria-describedby={describedBy}
                onChange={(event) =>
                  onChange({ ...values, [field.key]: event.target.value })
                }
              />
            )}
            {errors[field.key] !== undefined && (
              <p id={errorId} className="mt-1 text-xs text-red-600">
                {errors[field.key]}
              </p>
            )}
          </div>
        );
      })}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar cambios"}
        </button>
        {onCancelEdit !== undefined && (
          <button
            type="button"
            disabled={saving}
            onClick={onCancelEdit}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancelar edición
          </button>
        )}
      </div>
    </form>
  );
}
