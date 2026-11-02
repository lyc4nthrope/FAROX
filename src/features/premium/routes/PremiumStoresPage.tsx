import { useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { EmptyState } from "../../../shared/ui";
import { Badge, Status, buttonClass, runAction } from "../../../shared/ui/Box";
import { fetchMyOwnedStores, reactivatePremiumStores } from "../api";

/** 0033: tiendas propias, activas y pausadas por plan. */
export function PremiumStoresPage() {
  const { premium } = useAuth();
  const stores = useLoad(fetchMyOwnedStores, []);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  const active = (stores.data ?? []).filter((store) => store.isActive);
  const paused = (stores.data ?? []).filter(
    (store) => !store.isActive && store.deactivatedReason === "premium_expired",
  );

  async function reactivate(id: number): Promise<void> {
    setBusyId(id);
    setMsg({ error: null, ok: null });
    const error = await runAction(() => reactivatePremiumStores([id]));
    setBusyId(null);
    if (error !== null) {
      setMsg({ error, ok: null });
      return;
    }
    setMsg({ error: null, ok: "Tienda reactivada." });
    stores.reload();
  }

  return (
    <section className="mx-auto max-w-3xl">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">Plan</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Mis tiendas</h1>
      <p className="mt-1 text-sm text-gray-500">
        {active.length} de 3 tiendas activas. Las pausadas por plan conservan stock, pedidos, rutas
        y créditos; al renovar podés reactivarlas.
      </p>

      <Status loading={stores.loading} error={stores.error} />
      <Status error={msg.error} ok={msg.ok} />

      {stores.data !== null && stores.data.length === 0 && (
        <div className="mt-4">
          <EmptyState title="Todavía no tenés tiendas" hint="Creá una tienda desde Red → Tiendas." />
        </div>
      )}

      {stores.data !== null && stores.data.length > 0 && (
        <ul className="mt-4 space-y-2">
          {stores.data.map((store) => {
            const isPaused = !store.isActive && store.deactivatedReason === "premium_expired";
            const isPrincipal = store.isActive && !premium && active.length === 1;
            return (
              <li
                key={store.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                    {store.name}
                    {isPrincipal && <Badge tone="amber">Principal</Badge>}
                    {store.isActive ? (
                      <Badge tone="green">Activa</Badge>
                    ) : isPaused ? (
                      <Badge tone="amber">Pausada por plan</Badge>
                    ) : (
                      <Badge tone="gray">Inactiva</Badge>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {[store.city, `desde ${new Date(store.createdAt).toLocaleDateString("es-CO")}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {isPaused && (
                  <div className="shrink-0">
                    {premium ? (
                      <button
                        className={`${buttonClass} px-3 py-1.5 text-xs`}
                        type="button"
                        disabled={busyId === store.id}
                        onClick={() => void reactivate(store.id)}
                      >
                        {busyId === store.id ? "Reactivando…" : "Reactivar"}
                      </button>
                    ) : (
                      <Link
                        to="/premium"
                        className="inline-flex text-xs font-medium text-gray-900 underline-offset-4 hover:underline"
                      >
                        Renovar para reactivar
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {paused.length > 0 && !premium && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Tenés {paused.length} {paused.length === 1 ? "tienda pausada" : "tiendas pausadas"} por
          plan. Renová Premium para reactivarlas.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-3">
        <Link to="/profile" className="text-sm font-medium text-gray-700 underline-offset-4 hover:underline">
          Volver al perfil
        </Link>
        <Link to="/premium" className="text-sm font-medium text-gray-900 underline-offset-4 hover:underline">
          Ver planes
        </Link>
      </div>
    </section>
  );
}
