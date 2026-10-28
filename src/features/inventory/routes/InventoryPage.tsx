import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { formatCOP, formatQty } from "../../../shared/lib/format";
import {
  Badge,
  Box,
  Field,
  Status,
  buttonClass,
  inputClass,
  runAction,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import { EmptyState, PremiumLock, ProductPicker, QuantityStepper, type ProductPickerOption } from "../../../shared/ui";
import { Modal } from "../../../shared/ui/Modal";
import { StoreCatalogPanel } from "../../products/components/StoreCatalogPanel";
import {
  fetchMotives,
  fetchMovements,
  fetchMyStores,
  fetchPrices,
  fetchStockOptions,
  fetchStoreName,
  registerMovement,
  reverseMovement,
  setPrice,
  type MovementRow,
} from "../api";

/** /inventario — elegir tienda. */
export function InventoryStoresPage() {
  const { role } = useAuth();
  const stores = useLoad(() => fetchMyStores(role === "admin"), [role]);
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Inventario
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Inventario</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Elegí una tienda para ver su stock, registrar movimientos y ajustar precios.
      </p>
      <Box title="Elegí una tienda">
        <Status loading={stores.loading} error={stores.error} />
        {stores.data?.length === 0 && (
          <EmptyState
            title="No tenés tiendas en tu alcance"
            hint="Cuando tengas una tienda asignada, va a aparecer acá."
          />
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {stores.data?.map((s) => (
            <li key={s.id}>
              <Link
                className="group flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 text-sm shadow-sm transition hover:border-gray-300 hover:shadow-md"
                to={`/inventario/${s.id}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition group-hover:bg-gray-900 group-hover:text-white">
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z" />
                    <path d="m3 9 1.6-4.4A1 1 0 0 1 5.5 4h13a1 1 0 0 1 .9.6L21 9M9 20v-5h6v5" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 font-medium text-gray-900">{s.name}</span>
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-gray-900"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  viewBox="0 0 24 24"
                >
                  <path d="M5 12h14m-6-6 6 6-6 6" />
                </svg>
              </Link>
            </li>
          ))}
        </ul>
      </Box>
    </section>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

type InventoryTab = "products" | "movements" | "prices";
type ModalKind = "movement" | "price";

const TABS: readonly { id: InventoryTab; label: string }[] = [
  { id: "products", label: "Productos" },
  { id: "movements", label: "Movimientos" },
  { id: "prices", label: "Precios" },
];

const PANEL_CLASS = "mt-3 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm sm:p-5";

const MOVEMENT_TONES = {
  entry: {
    border: "border-l-emerald-500",
    background: "bg-emerald-50/40",
    icon: "bg-emerald-100 text-emerald-700",
    quantity: "text-emerald-700",
    badge: "green" as const,
    label: "Entrada",
  },
  exit: {
    border: "border-l-sky-500",
    background: "bg-sky-50/40",
    icon: "bg-sky-100 text-sky-700",
    quantity: "text-sky-700",
    badge: "blue" as const,
    label: "Salida",
  },
  reverse: {
    border: "border-l-amber-500",
    background: "bg-amber-50/40",
    icon: "bg-amber-100 text-amber-700",
    quantity: "text-amber-700",
    badge: "amber" as const,
    label: "Reverso",
  },
};

function movementTone(movement: MovementRow): keyof typeof MOVEMENT_TONES {
  return movement.reverso_of_id === null ? movement.type : "reverse";
}

function movementIcon(tone: keyof typeof MOVEMENT_TONES): ReactNode {
  if (tone === "entry") {
    return (
      <Icon>
        <path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14" />
      </Icon>
    );
  }
  if (tone === "exit") {
    return (
      <Icon>
        <path d="M12 20V8m0 0 5 5m-5-5-5 5M5 4h14" />
      </Icon>
    );
  }
  return (
    <Icon>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </Icon>
  );
}

function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function segmentClass(active: boolean, tone: "entry" | "exit"): string {
  const base =
    "rounded-lg px-4 py-1.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
  if (!active) return `${base} text-gray-600 hover:text-gray-900`;
  return `${base} ${tone === "entry" ? "bg-emerald-600 text-white shadow-sm" : "bg-sky-600 text-white shadow-sm"}`;
}

function InventoryTabBar({
  active,
  onChange,
}: {
  active: InventoryTab;
  onChange: (tab: InventoryTab) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const current = TABS.findIndex((tab) => tab.id === active);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    const target = TABS[next];
    onChange(target.id);
    document.getElementById(`inventory-tab-${target.id}`)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Secciones del inventario"
      className="mt-5 flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm"
    >
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            id={`inventory-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`inventory-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={onKeyDown}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition ${
              selected
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** /inventario/:storeId — productos/asignación, movimientos y precios. */
export function InventoryPage() {
  const storeId = Number(useParams().storeId);
  const { role, premium } = useAuth();
  const isAdmin = role === "admin";

  const storeName = useLoad(() => fetchStoreName(storeId), [storeId]);
  const stockOptions = useLoad(() => fetchStockOptions(storeId), [storeId]);
  const movements = useLoad(() => fetchMovements(storeId), [storeId]);
  const prices = useLoad(() => fetchPrices(storeId), [storeId]);
  const motives = useLoad(() => fetchMotives(), []);

  const stockPickerOptions = useMemo<ProductPickerOption[]>(
    () =>
      (stockOptions.data ?? []).map((row) => ({
        id: row.product_id,
        name: row.product_name,
        brand: row.brand,
        quantity: row.quantity,
      })),
    [stockOptions.data],
  );

  const [tab, setTab] = useState<InventoryTab>("products");
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [msg, setMsg] = useState<{ error: string | null; ok: string | null }>({
    error: null,
    ok: null,
  });

  const reloadAll = () => {
    stockOptions.reload();
    movements.reload();
    prices.reload();
    setCatalogVersion((value) => value + 1);
  };

  async function act(action: () => Promise<{ error: { message: string } | null }>, ok: string) {
    setBusy(true);
    try {
      const error = await runAction(action);
      setMsg({ error, ok: error === null ? ok : null });
      if (error === null) reloadAll();
      return error === null;
    } finally {
      setBusy(false);
    }
  }

  function openModal(kind: ModalKind) {
    setMsg({ error: null, ok: null });
    setModal(kind);
  }

  // --- movimiento
  const [mov, setMov] = useState({
    type: "entry" as "entry" | "exit",
    productId: "",
    quantity: "",
    motiveId: "",
    expiry: "",
  });
  const [movementSearch, setMovementSearch] = useState("");
  async function onMovement(event: FormEvent) {
    event.preventDefault();
    if (mov.productId === "" || mov.motiveId === "" || Number(mov.quantity) <= 0) {
      setMsg({ error: "Completá producto, una cantidad mayor a 0 y motivo.", ok: null });
      return;
    }
    const success = await act(
      () =>
        registerMovement({
          type: mov.type,
          storeId,
          productId: Number(mov.productId),
          quantity: Number(mov.quantity),
          motiveId: Number(mov.motiveId),
          expiryDate: mov.type === "entry" && mov.expiry !== "" ? mov.expiry : null,
        }),
      mov.type === "entry" ? "Entrada registrada." : "Salida registrada.",
    );
    if (success) {
      setMov({ type: "entry", productId: "", quantity: "", motiveId: "", expiry: "" });
      setMovementSearch("");
      setModal(null);
    }
  }

  // --- precio
  const [price, setPriceForm] = useState({ productId: "", price: "" });
  async function onPrice(event: FormEvent) {
    event.preventDefault();
    if (price.productId === "" || Number(price.price) <= 0) {
      setMsg({ error: "Elegí un producto e ingresá un precio mayor a 0.", ok: null });
      return;
    }
    const success = await act(
      () => setPrice(storeId, Number(price.productId), Number(price.price)),
      "Precio guardado.",
    );
    if (success) {
      setPriceForm({ productId: "", price: "" });
      setModal(null);
    }
  }

  async function onReverse(movement: MovementRow) {
    const reason = window.prompt("Motivo del reverso");
    if (!reason) return;
    await act(() => reverseMovement(movement.id, reason), "Movimiento revertido.");
  }

  // Movimientos que ya tienen reverso: no se pueden revertir de nuevo.
  const reversed = new Set(
    (movements.data ?? [])
      .map((movement) => movement.reverso_of_id)
      .filter((id): id is number => id !== null),
  );

  const motiveOptions =
    motives.data?.filter((m) => m.suggested_type === null || m.suggested_type === mov.type) ?? [];
  const selectedStock =
    stockOptions.data?.find((row) => row.product_id === Number(mov.productId)) ?? null;
  const movementProducts = (stockOptions.data ?? []).filter((row) =>
    normalizeSearch(`${row.product_name} ${row.brand ?? ""}`).includes(
      normalizeSearch(movementSearch),
    ),
  );
  const selectedPrice =
    prices.data?.find((row) => row.product_id === Number(price.productId)) ?? null;
  const sortedPrices = [...(prices.data ?? [])].sort((a, b) =>
    a.product_name.localeCompare(b.product_name, "es"),
  );

  const movementForm = (
    <form onSubmit={onMovement}>
      <div className="mb-4">
        <span className="block text-xs font-semibold tracking-wide text-gray-600">Tipo</span>
        <div
          role="group"
          aria-label="Tipo de movimiento"
          className="mt-1.5 inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1"
        >
          <button
            type="button"
            aria-pressed={mov.type === "entry"}
            className={segmentClass(mov.type === "entry", "entry")}
            onClick={() => setMov({ ...mov, type: "entry", motiveId: "" })}
          >
            Entrada
          </button>
          <button
            type="button"
            aria-pressed={mov.type === "exit"}
            className={segmentClass(mov.type === "exit", "exit")}
            onClick={() => setMov({ ...mov, type: "exit", motiveId: "" })}
          >
            Salida
          </button>
        </div>
      </div>

      <div className="mb-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-semibold tracking-wide text-gray-600">Producto</span>
          <input
            className={inputClass}
            type="search"
            placeholder="Nombre o marca…"
            aria-label="Buscar producto"
            autoFocus
            value={movementSearch}
            onChange={(event) => setMovementSearch(event.target.value)}
          />
        </label>
        <Status loading={stockOptions.loading} error={stockOptions.error} />
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-gray-100">
          {movementProducts.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-500">
              {stockOptions.data?.length === 0
                ? "La tienda no tiene productos asignados. Usá «Agregar productos» primero."
                : "Ningún producto coincide con la búsqueda."}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {movementProducts.map((row) => {
                const selected = String(row.product_id) === mov.productId;
                return (
                  <li key={row.product_id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setMov({
                          ...mov,
                          productId: String(row.product_id),
                          quantity: mov.quantity === "" ? "1" : mov.quantity,
                        })
                      }
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition ${
                        selected ? "bg-gray-900 text-white" : "hover:bg-gray-50"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{row.product_name}</span>
                        <span
                          className={`block truncate text-xs ${
                            selected ? "text-gray-300" : "text-gray-500"
                          }`}
                        >
                          {row.brand ?? "Sin marca"} · Stock: {formatQty(row.quantity)}
                        </span>
                      </span>
                      {selected && (
                        <span aria-hidden="true" className="text-xs font-semibold">
                          Elegido
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mb-4">
        <span className="block text-xs font-semibold tracking-wide text-gray-600">
          Cantidad
        </span>
        <div className="mt-1.5">
          <QuantityStepper
            label={selectedStock?.product_name ?? "movimiento"}
            value={mov.quantity}
            onChange={(quantity) => setMov({ ...mov, quantity })}
          />
        </div>
      </div>

      <Status loading={motives.loading} error={motives.error} />
      <Field label="Motivo">
        <select
          className={inputClass}
          value={mov.motiveId}
          onChange={(e) => setMov({ ...mov, motiveId: e.target.value })}
          required
        >
          <option value="">— elegir —</option>
          {motiveOptions.map((motive) => (
            <option key={motive.id} value={motive.id}>
              {motive.name}
            </option>
          ))}
        </select>
      </Field>

      {mov.type === "entry" && (
        <Field label="Fecha de vencimiento (opcional)">
          <input
            className={inputClass}
            type="date"
            value={mov.expiry}
            onChange={(e) => setMov({ ...mov, expiry: e.target.value })}
          />
        </Field>
      )}

      <button className={buttonClass} type="submit" disabled={busy}>
        {busy ? "Registrando…" : mov.type === "entry" ? "Registrar entrada" : "Registrar salida"}
      </button>
    </form>
  );

  const priceForm = (
    <form onSubmit={onPrice}>
      <ProductPicker
        label="Producto"
        value={price.productId}
        onChange={(value) => setPriceForm({ ...price, productId: value })}
        options={stockPickerOptions}
        loading={stockOptions.loading}
        error={stockOptions.error}
        required
        showQuantityFilter
        autoFocusSearch
        emptyHint="La tienda no tiene productos asignados. Usá «Agregar productos» primero."
      />
      {selectedPrice !== null && (
        <p className="-mt-3 mb-3 text-xs text-gray-500">
          Precio actual:{" "}
          <span className="font-medium text-gray-900">{formatCOP(selectedPrice.price)}</span>
        </p>
      )}
      <Field label="Precio (COP)">
        <input
          className={inputClass}
          type="number"
          min="0.01"
          step="0.01"
          value={price.price}
          onChange={(e) => setPriceForm({ ...price, price: e.target.value })}
          required
        />
      </Field>
      <button className={buttonClass} type="submit" disabled={busy}>
        {busy ? "Guardando…" : "Guardar precio"}
      </button>
    </form>
  );

  return (
    <section>
      <Link
        to="/inventario"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-900"
      >
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Tiendas
      </Link>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            Inventario
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {storeName.data ?? `Tienda #${storeId}`}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            Productos, movimientos y precios de la tienda en un solo lugar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} type="button" onClick={() => openModal("movement")}>
            <Icon>
              {premium ? (
                <path d="M7 17V7m0 0-3 3m3-3 3 3M17 7v10m0 0 3-3m-3 3-3-3" />
              ) : (
                <>
                  <rect height="11" rx="2" width="16" x="4" y="10" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </>
              )}
            </Icon>
            Registrar movimiento
            {!premium && (
              <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
                Premium
              </span>
            )}
          </button>
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={() => setTab("products")}
          >
            <Icon>
              <path d="M12 5v14M5 12h14" />
            </Icon>
            Productos de la tienda
          </button>
          <Link className={secondaryButtonClass} to={`/tiendas/${storeId}/qr`}>
            <Icon>
              <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
              <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" />
            </Icon>
            QR de vínculo
          </Link>
        </div>
      </div>

      <Status error={msg.error} ok={msg.ok} />

      <InventoryTabBar active={tab} onChange={setTab} />

      {tab === "products" && (
        <section
          role="tabpanel"
          id="inventory-panel-products"
          aria-labelledby="inventory-tab-products"
          className={PANEL_CLASS}
        >
          <StoreCatalogPanel
            storeId={storeId}
            storeName={storeName.data ?? `Tienda #${storeId}`}
            reloadToken={catalogVersion}
            onChanged={() => stockOptions.reload()}
          />
        </section>
      )}

      {tab === "movements" && (
        <section
          role="tabpanel"
          id="inventory-panel-movements"
          aria-labelledby="inventory-tab-movements"
          className={PANEL_CLASS}
        >
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-gray-900">
                Últimos movimientos
              </h2>
              <p className="text-xs text-gray-500">
                Entradas en verde, salidas en azul y reversos en ámbar.
              </p>
            </div>
            <span className="text-xs font-medium text-gray-500">Últimos 50</span>
          </div>

          <Status loading={movements.loading} error={movements.error} />
          {movements.data?.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Todavía no hay movimientos en esta tienda"
                hint="Las entradas y salidas que registres van a aparecer acá."
              />
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {movements.data?.map((movement) => {
                const toneKey = movementTone(movement);
                const tone = MOVEMENT_TONES[toneKey];
                return (
                  <li
                    key={movement.id}
                    data-tone={toneKey}
                    className={`flex flex-wrap items-start gap-3 rounded-r-xl border-y border-r border-y-gray-200 border-r-gray-200 border-l-4 px-3 py-3 ${tone.border} ${tone.background}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}
                    >
                      {movementIcon(toneKey)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="min-w-0 truncate text-sm font-medium text-gray-900">
                          {movement.product_name}
                        </p>
                        <p className={`text-sm font-semibold tabular-nums ${tone.quantity}`}>
                          {movement.type === "entry" ? "+" : "−"}
                          {formatQty(movement.quantity)}
                        </p>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <Badge tone={tone.badge}>{tone.label}</Badge>
                        <span>{new Date(movement.created_at).toLocaleString("es-CO")}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {movement.reverso_of_id === null
                            ? movement.motive_name
                            : `Reverso de #${movement.reverso_of_id}`}
                        </span>
                        {reversed.has(movement.id) && <Badge tone="amber">Revertido</Badge>}
                      </div>
                    </div>
                    {isAdmin && movement.reverso_of_id === null && !reversed.has(movement.id) && (
                      <button
                        type="button"
                        className={`${secondaryButtonClass} px-3 py-1.5 text-xs`}
                        disabled={busy}
                        onClick={() => void onReverse(movement)}
                      >
                        Revertir
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === "prices" && (
        <section
          role="tabpanel"
          id="inventory-panel-prices"
          aria-labelledby="inventory-tab-prices"
          className={PANEL_CLASS}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-gray-900">
                Precios de la tienda
              </h2>
              <p className="text-xs text-gray-500">Precio de venta publicado para cada producto.</p>
            </div>
            {isAdmin && (
              <button className={buttonClass} type="button" onClick={() => openModal("price")}>
                <Icon>
                  <path d="M12 5v14M5 12h14" />
                </Icon>
                Publicar precio
              </button>
            )}
          </div>

          <Status loading={prices.loading} error={prices.error} />
          {prices.data?.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="La tienda todavía no tiene precios publicados"
                hint={
                  isAdmin
                    ? "Usá «Publicar precio» para cargar el primero."
                    : "Cuando se publiquen precios, van a aparecer acá."
                }
              />
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {sortedPrices.map((row) => (
                <li
                  key={row.product_id}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                    {row.product_name}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-gray-900">
                    {formatCOP(row.price)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {modal === "movement" && (
        <Modal title="Registrar entrada o salida" onClose={() => setModal(null)}>
          <Status error={msg.error} />
          {premium ? (
            movementForm
          ) : (
            <PremiumLock
              title="Movimientos manuales"
              benefits={[
                "Registrar entradas y salidas manuales, con motivo y vencimiento.",
                "Dashboard analítico con totales y valores del rango que elijas.",
                "Precios por producto en los pedidos y QR de vínculo masivo.",
              ]}
            >
              {movementForm}
            </PremiumLock>
          )}
        </Modal>
      )}

      {modal === "price" && (
        <Modal title="Publicar precio" onClose={() => setModal(null)}>
          <Status error={msg.error} />
          {priceForm}
        </Modal>
      )}
    </section>
  );
}
