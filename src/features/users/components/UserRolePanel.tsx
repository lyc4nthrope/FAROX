import { roleLabel } from "../../../app/shell/navigation";
import { ROLE_NAMES, type RoleName } from "../../auth/types";
import type { DistributorOption } from "../types";

export interface RoleFormErrors {
  role?: string;
  distributor_id?: string;
}

interface UserRolePanelProps {
  /** "" = sin rol reconocido todavía (legacy R3 / fila nueva): el select exige elegir. */
  role: RoleName | "";
  distributorId: string;
  distributorOptions: DistributorOption[];
  errors: RoleFormErrors;
  // SIEMPRE mapeado por mapError() en el contenedor (HARD-1).
  error: string | null;
  notice: string | null;
  saving: boolean;
  onChange: (next: { role: RoleName | ""; distributorId: string }) => void;
  onSubmit: () => void;
}

// Presentacional pura (D1) · sdd/admin-console T-B6 (ADM-5): el cambio de rol
// viaja EXCLUSIVAMENTE por la rpc update_user_role — este form nunca arma un
// UPDATE de role_id (columna privilegiada, D45). El picker de distribuidor
// aparece SOLO para el rol «distribuidor» (espejo cliente de M11, 0011:93-95).
export function UserRolePanel({
  role,
  distributorId,
  distributorOptions,
  errors,
  error,
  notice,
  saving,
  onChange,
  onSubmit,
}: UserRolePanelProps) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold">Rol</h2>
      <form
        noValidate
        className="mt-3 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {error !== null && (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
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
          <label htmlFor="user-role" className="block text-sm font-medium text-gray-700">
            Rol
          </label>
          <select
            id="user-role"
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            value={role}
            aria-invalid={errors.role !== undefined}
            aria-describedby={errors.role === undefined ? undefined : "user-role-error"}
            onChange={(event) =>
              onChange({
                role: event.target.value as RoleName | "",
                distributorId,
              })
            }
          >
            {role === "" && <option value="">Elegí un rol</option>}
            {ROLE_NAMES.map((name) => (
              <option key={name} value={name}>
                {roleLabel(name)}
              </option>
            ))}
          </select>
          {errors.role !== undefined && (
            <p id="user-role-error" className="mt-1 text-xs text-red-600">
              {errors.role}
            </p>
          )}
        </div>
        {role === "distribuidor" && (
          <div>
            <label
              htmlFor="user-distributor"
              className="block text-sm font-medium text-gray-700"
            >
              Distribuidor
            </label>
            <select
              id="user-distributor"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={distributorId}
              aria-invalid={errors.distributor_id !== undefined}
              aria-describedby={
                errors.distributor_id === undefined
                  ? undefined
                  : "user-distributor-error"
              }
              onChange={(event) =>
                onChange({ role, distributorId: event.target.value })
              }
            >
              <option value="">Elegí un distribuidor</option>
              {distributorOptions.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.name}
                </option>
              ))}
            </select>
            {errors.distributor_id !== undefined && (
              <p id="user-distributor-error" className="mt-1 text-xs text-red-600">
                {errors.distributor_id}
              </p>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar rol"}
        </button>
      </form>
    </section>
  );
}
