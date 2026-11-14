import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { Status, buttonClass, runAction, secondaryButtonClass } from "../../../shared/ui/Box";
import { Modal } from "../../../shared/ui/Modal";
import { chooseStoreForFreePlan, fetchMyOwnedStores, fetchMyPremiumStatus } from "../api";
import { formatPremiumDate } from "../format";

/**
 * 0033: al vencer Premium, el usuario con 2–3 tiendas elige una principal o
 * renueva. Durante la gracia se puede posponer; al terminar, el modal bloquea.
 */
export function PremiumDowngradeModal() {
  const { role } = useAuth();
  const location = useLocation();
  const isPremiumPath = location.pathname.startsWith("/premium");
  const status = useLoad(
    () =>
      role === "operador" && !isPremiumPath
        ? fetchMyPremiumStatus()
        : Promise.resolve({ data: null, error: null }),
    [role, isPremiumPath],
  );
  const stores = useLoad(
    () =>
      role === "operador" && !isPremiumPath
        ? fetchMyOwnedStores()
        : Promise.resolve({ data: null, error: null }),
    [role, isPremiumPath],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeStores = useMemo(
    () => (stores.data ?? []).filter((store) => store.isActive),
    [stores.data],
  );

  useEffect(() => {
    if (activeStores.length === 0) return;
    if (selected === null || !activeStores.some((store) => store.id === selected)) {
      setSelected(activeStores[0].id);
    }
  }, [activeStores, selected]);

  if (role !== "operador") return null;
  if (location.pathname.startsWith("/premium")) return null;
  if (status.data === null) return null;

  const { activeOwnedStores, graceActive, needsStoreChoice, premiumGraceUntil } = status.data;
  if (activeOwnedStores <= 1) return null;
  if (!graceActive && !needsStoreChoice) return null;
  if (dismissed && graceActive) return null;
  if (activeStores.length <= 1) return null;

  const blocking = !graceActive && needsStoreChoice;
  const grace = formatPremiumDate(premiumGraceUntil);

  async function keepStore(): Promise<void> {
    if (selected === null) {
      setError("Elegí una tienda.");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await runAction(() => chooseStoreForFreePlan(selected));
    setSaving(false);
    if (result !== null) {
      setError(result);
      return;
    }
    status.reload();
    stores.reload();
  }

  return (
    <Modal
      title="Tu Premium venció"
      blocking={blocking}
      onClose={() => {
        if (!blocking) setDismissed(true);
      }}
    >
      <div className="space-y-4 text-sm text-gray-700">
        <p>
          Elegí una tienda para conservar como principal, o renová para mantener las{" "}
          <strong>{activeStores.length} tiendas activas</strong>. Las demás se pausan, no se borran.
        </p>
        {graceActive && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            Tenés hasta el {grace ?? "final de la gracia"} para decidir. Después se conserva
            automáticamente la tienda más antigua.
          </p>
        )}
        {!graceActive && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-900">
            La gracia terminó. Elegí una tienda para continuar usando FAROX.
          </p>
        )}

        <Status loading={stores.loading} error={stores.error} />
        <fieldset>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">
            Tienda principal
          </legend>
          <div className="space-y-2">
            {activeStores.map((store) => (
              <label
                key={store.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition ${
                  selected === store.id
                    ? "border-gray-900 bg-gray-50"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                <input
                  type="radio"
                  name="premium-store"
                  className="mt-1 h-4 w-4 accent-gray-900"
                  checked={selected === store.id}
                  onChange={() => setSelected(store.id)}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">{store.name}</span>
                  <span className="block text-xs text-gray-500">
                    {store.city ?? "Sin ciudad"} · desde{" "}
                    {new Date(store.createdAt).toLocaleDateString("es-CO")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Status error={error} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={buttonClass}
            type="button"
            disabled={saving}
            onClick={() => void keepStore()}
          >
            {saving ? "Guardando…" : "Conservar esta tienda"}
          </button>
          <Link className={secondaryButtonClass} to="/premium">
            Renovar Premium
          </Link>
          {!blocking && (
            <button
              className="rounded-lg px-2.5 py-2 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
              type="button"
              onClick={() => setDismissed(true)}
            >
              Decidir después
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
