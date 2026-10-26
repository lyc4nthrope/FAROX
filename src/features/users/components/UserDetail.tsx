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
      : (distributorOptions.find((option) => option.id === user.distributor_id) ?? null);

  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight">{user.full_name}</h1>
      <p className="mt-1 text-sm text-gray-600">{user.email ?? "Sin email"}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-gray-900 px-2.5 py-0.5 font-medium text-white">
          {roleLabel(normalizeRole(user.role?.name ?? null))}
        </span>
        {user.premium && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
            <svg aria-hidden="true" className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2.5 14.6 9l6.9.5-5.3 4.5 1.7 6.7-5.9-3.6-5.9 3.6 1.7-6.7L2.5 9.5 9.4 9 12 2.5Z" />
            </svg>
            Premium
          </span>
        )}
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium ring-1 ring-inset ${
            user.is_active
              ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
              : "bg-gray-100 text-gray-500 ring-gray-200"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              user.is_active ? "bg-emerald-500" : "bg-gray-400"
            }`}
          />
          {user.is_active ? "Activo" : "Inactivo"}
        </span>
        {/* T-E3 (in-scope #5): cross-link a la pantalla existente de
            Distribuidores — /distributors/:id es ruta admin|operador, así que
            el admin del detalle siempre puede seguirla. */}
        {distribuidor !== null && user.distributor_id !== null && (
          <Link to={`/distributors/${user.distributor_id}`} className="text-gray-500 underline">
            Distribuidor: {distribuidor.name}
          </Link>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {error !== null && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 border-l-4 border-l-red-500 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {notice !== null && (
          <p
            role="status"
            className="rounded-xl border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {notice}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className={`rounded-xl border p-3.5 shadow-sm ${
              user.premium ? "border-amber-200 bg-amber-50/60" : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">Premium</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Dashboard, movimientos manuales y QR masivo.
                </p>
              </div>
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  role="switch"
                  className="h-4 w-4 accent-amber-600"
                  checked={user.premium}
                  disabled={premiumBusy}
                  onChange={(event) => onTogglePremium(event.target.checked)}
                />
                <span className="sr-only">Premium</span>
              </label>
            </div>
          </div>
          <div
            className={`rounded-xl border p-3.5 shadow-sm ${
              user.is_active ? "border-emerald-200 bg-emerald-50/50" : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">Activo</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {user.is_active
                    ? "Puede iniciar sesión y operar."
                    : "Sin acceso al sistema hasta reactivarlo."}
                </p>
              </div>
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  role="switch"
                  className="h-4 w-4 accent-emerald-600"
                  checked={user.is_active}
                  disabled={activeBusy || isSelf}
                  onChange={(event) => onToggleActive(event.target.checked)}
                />
                <span className="sr-only">Activo</span>
              </label>
            </div>
          </div>
        </div>
        {/* R5/ADM-6.2: el backend NO tiene guard de auto-desactivación
            (0011:126-139) y un admin auto-desactivado pierde assert_admin
            (requiere is_active, 0011:64) ⇒ la guarda vive en la UI. */}
        {isSelf && <p className="text-xs text-gray-500">No te podés desactivar a vos mismo.</p>}
      </div>
    </section>
  );
}
