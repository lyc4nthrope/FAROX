import { Link } from "react-router-dom";

import { roleLabel } from "../../../app/shell/navigation";
import { normalizeRole } from "../../auth/types";
import type { DistributorOption, UserDetailRow } from "../types";

export interface UserDetailProps {
  user: UserDetailRow;
  /** true = la fila es de la SESIÓN actual (guards de auto-gestión, ADM-6.2). */
  isSelf: boolean;
  distributorOptions: DistributorOption[];
  premiumBusy: boolean;
  activeBusy: boolean;
  // SIEMPRE mapeados por mapError() en el contenedor (HARD-1).
  error: string | null;
  notice: string | null;
  onTogglePremium: (value: boolean) => void;
  onToggleActive: (value: boolean) => void;
}

// Presentacional pura (D1) · sdd/admin-console T-B5/T-B7: cabecera del
// detalle + toggles premium/activo. Ambos toggles usan EXCLUSIVAMENTE las RPCs
// set_user_premium / set_user_active (0011:486-488) — el contenedor las
// invoca, acá solo emiten el cambio (HARD-3: refetch posterior, sin optimistic).
export function UserDetail({
  user,
  isSelf,
  distributorOptions,
  premiumBusy,
  activeBusy,
  error,
  notice,
  onTogglePremium,
  onToggleActive,
}: UserDetailProps) {
  const distribuidor =
    user.distributor_id === null
      ? null
      : (distributorOptions.find((option) => option.id === user.distributor_id) ??
        null);

  return (
    <section>
      <h1 className="text-xl font-semibold">{user.full_name}</h1>
      <p className="mt-1 text-sm text-gray-600">{user.email ?? "Sin email"}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-gray-900 px-2 py-0.5 font-medium text-white">
          {roleLabel(normalizeRole(user.role?.name ?? null))}
        </span>
        {user.premium && (
          <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
            Premium
          </span>
        )}
        <span
          className={`rounded px-2 py-0.5 font-medium ${
            user.is_active
              ? "bg-green-100 text-green-800"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {user.is_active ? "Activo" : "Inactivo"}
        </span>
        {/* T-E3 (in-scope #5): cross-link a la pantalla existente de
            Distribuidores — /distributors/:id es ruta admin|operador, así que
            el admin del detalle siempre puede seguirla. */}
        {distribuidor !== null && user.distributor_id !== null && (
          <Link
            to={`/distributors/${user.distributor_id}`}
            className="text-gray-500 underline"
          >
            Distribuidor: {distribuidor.name}
          </Link>
        )}
      </div>

      <div className="mt-4 space-y-2">
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
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            role="switch"
            checked={user.premium}
            disabled={premiumBusy}
            onChange={(event) => onTogglePremium(event.target.checked)}
          />
          Premium
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            role="switch"
            checked={user.is_active}
            disabled={activeBusy || isSelf}
            onChange={(event) => onToggleActive(event.target.checked)}
          />
          Activo
        </label>
        {/* R5/ADM-6.2: el backend NO tiene guard de auto-desactivación
            (0011:126-139) y un admin auto-desactivado pierde assert_admin
            (requiere is_active, 0011:64) ⇒ la guarda vive en la UI. */}
        {isSelf && (
          <p className="text-xs text-gray-500">
            No te podés desactivar a vos mismo.
          </p>
        )}
      </div>
    </section>
  );
}
