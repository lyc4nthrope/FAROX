import { useMemo, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { useLoad } from "../../../shared/hooks/useLoad";
import { formatCOP } from "../../../shared/lib/format";
import {
  Box,
  Field,
  Status,
  buttonClass,
  inputClass,
  runAction,
  secondaryButtonClass,
} from "../../../shared/ui/Box";
import { MovementList } from "../components/MovementList";
import { MovementCart, netUnitPrice, type CartLine } from "../components/MovementCart";
import { sortBySalesRanking } from "../ranking";
import { EmptyState, PremiumLock, ProductPicker, type ProductPickerOption } from "../../../shared/ui";
import { Modal } from "../../../shared/ui/Modal";
import { StoreCatalogPanel } from "../../products/components/StoreCatalogPanel";
import { fetchStorePurchasePrices } from "../../products/api";
import {
  fetchMotives,
  fetchMovements,
  fetchMovementRanking,
  fetchMyStores,
  fetchPrices,
  fetchStockOptions,
  fetchStoreName,
  registerMovementsBulk,
  deleteMovementTemplate,
  fetchMovementTemplates,
  saveMovementTemplate,
  reverseMovement,
  setPrice,
  type MovementProductOption,
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

type MovementFilter = "all" | "entry" | "exit";

const MOVEMENT_FILTERS: readonly { id: MovementFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "entry", label: "Entradas" },
  { id: "exit", label: "Salidas" },
];

// 0037: color por tipo de acción, igual que los tonos de MovementList
// (entrada/compra en verde, salida/venta en azul).
function movementActionClass(type: "entry" | "exit"): string {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium text-white shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50";
  return type === "entry"
    ? `${base} bg-emerald-600 hover:bg-emerald-700 focus-visible:outline-emerald-600`
    : `${base} bg-sky-600 hover:bg-sky-700 focus-visible:outline-sky-600`;
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
  // 0030: coste privado de la tienda (tabla con RLS operator/admin).
  const purchasePrices = useLoad(() => fetchStorePurchasePrices(storeId), [storeId]);
  const motives = useLoad(() => fetchMotives(), []);
  // 0040: ranking por ventas para ordenar el ticket.
  const ranking = useLoad(() => fetchMovementRanking({ storeId }), [storeId]);

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
    purchasePrices.reload();
    ranking.reload();
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

  // --- movimiento (0037: ticket multi-producto)
  const [mov, setMov] = useState({
    type: "entry" as "entry" | "exit",
    motiveId: "",
    expiry: "",
  });
  const [moveFilter, setMoveFilter] = useState<"all" | "entry" | "exit">("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discount, setDiscount] = useState("");

  // 0038: plantillas del tipo que se está cargando; solo se piden con el
  // diálogo abierto para no sumar requests a la pantalla.
  const templates = useLoad(
    () =>
      modal === "movement"
        ? fetchMovementTemplates({ kind: mov.type, storeId })
        : Promise.resolve({ data: null, error: null }),
    [modal, mov.type, storeId],
  );

  function openMovement(type: "entry" | "exit") {
    setMsg({ error: null, ok: null });
    setMov({ type, motiveId: "", expiry: "" });
    setCart([]);
    setDiscount("");
    setModal("movement");
  }

  async function onMovement(event: FormEvent) {
    event.preventDefault();
    if (cart.length === 0) {
      setMsg({ error: "Agregá al menos un producto al ticket.", ok: null });
      return;
    }
    if (mov.motiveId === "") {
      setMsg({ error: "Elegí un motivo.", ok: null });
      return;
    }
    if (cart.some((line) => !(Number(line.quantity) > 0))) {
      setMsg({ error: "La cantidad debe ser mayor a 0 en cada línea.", ok: null });
      return;
    }
    const discountValue = discount.trim() === "" ? null : Number(discount);
    if (
      discountValue !== null &&
      (!Number.isFinite(discountValue) || discountValue < 0 || discountValue > 100)
    ) {
      setMsg({ error: "El descuento debe estar entre 0 y 100.", ok: null });
      return;
    }
    const discountInput = mov.type === "exit" ? (discountValue?.toString() ?? "") : "";
    const lines = cart.map((line) => ({
      productId: line.productId,
      quantity: Number(line.quantity),
      unitPrice: premium ? netUnitPrice(line.unitPrice, discountInput) : null,
      expiryDate: mov.type === "entry" && mov.expiry !== "" ? mov.expiry : null,
    }));
    const success = await act(
      () =>
        registerMovementsBulk({
          storeId,
          type: mov.type,
          motiveId: Number(mov.motiveId),
          lines,
          discountPct: mov.type === "exit" ? discountValue : null,
        }),
      `${mov.type === "entry" ? "Compra" : "Venta"} registrada (${lines.length} ${
        lines.length === 1 ? "producto" : "productos"
      }).`,
    );
    if (success) {
      setCart([]);
      setDiscount("");
      setMov({ type: mov.type, motiveId: "", expiry: "" });
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

  const motiveOptions =
    motives.data?.filter((m) => m.suggested_type === null || m.suggested_type === mov.type) ?? [];

  // Opciones del ticket: stock de la tienda + precios de compra/venta vigentes,
  // ordenadas por ventas (0040) para que lo que más rota quede primero.
  const movementOptions = useMemo<MovementProductOption[]>(() => {
    const salePrices = new Map((prices.data ?? []).map((row) => [row.product_id, row.price]));
    const options = (stockOptions.data ?? []).map((row) => ({
      id: row.product_id,
      name: row.product_name,
      brand: row.brand,
      barcode: row.barcode ?? null,
      quantity: row.quantity,
      purchasePrice: purchasePrices.data?.get(row.product_id) ?? null,
      salePrice: salePrices.get(row.product_id) ?? null,
    }));
    return sortBySalesRanking(options, ranking.data ?? new Map());
  }, [stockOptions.data, purchasePrices.data, prices.data, ranking.data]);
  const visibleMovements = (movements.data ?? []).filter(
    (movement) => moveFilter === "all" || movement.type === moveFilter,
  );
  // 0038: últimos productos vendidos en esta tienda (sin reversos), para los
  // atajos del ticket. Se derivan de los mismos 50 movimientos ya cargados.
  const recentSoldIds = useMemo(() => {
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const movement of movements.data ?? []) {
      if (movement.type !== "exit" || movement.reverso_of_id !== null) continue;
      const id = movement.product_id;
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length === 6) break;
    }
    return ids;
  }, [movements.data]);
  const selectedPrice =
    prices.data?.find((row) => row.product_id === Number(price.productId)) ?? null;
  const sortedPrices = [...(prices.data ?? [])].sort((a, b) =>
    a.product_name.localeCompare(b.product_name, "es"),
  );

  const movementForm = (
    <form onSubmit={onMovement}>
      <div className="mx-auto w-full max-w-md">
        <Status loading={motives.loading} error={motives.error} />
        <Field label="Motivo">
          <select
            className={`${inputClass} w-full`}
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
              className={`${inputClass} w-full`}
              type="date"
              value={mov.expiry}
              onChange={(e) => setMov({ ...mov, expiry: e.target.value })}
            />
          </Field>
        )}
      </div>

      <MovementCart
        options={movementOptions}
        loading={stockOptions.loading}
        error={stockOptions.error}
        lines={cart}
        onChange={setCart}
        priceKind={mov.type === "entry" ? "purchase" : "sale"}
        showPrices={premium}
        showDiscount={mov.type === "exit"}
        discount={discount}
        onDiscountChange={setDiscount}
        emptyHint="La tienda no tiene productos asignados. Usá «Agregar productos» primero."
        recentProductIds={mov.type === "exit" ? recentSoldIds : []}
        templates={templates.data ?? []}
        onSaveTemplate={async (name) => {
          const error = await runAction(() =>
            saveMovementTemplate({
              name,
              kind: mov.type,
              storeId,
              lines: cart.map((line) => ({
                productId: line.productId,
                quantity: Number(line.quantity),
              })),
            }),
          );
          if (error === null) templates.reload();
          return error;
        }}
        onDeleteTemplate={(template) => {
          void runAction(() => deleteMovementTemplate(template.id)).then((error) => {
            if (error === null) templates.reload();
            else setMsg({ error, ok: null });
          });
        }}
        action={
          <button className={buttonClass} type="submit" disabled={busy}>
            {busy
              ? "Registrando…"
              : mov.type === "entry"
                ? "Registrar compra"
                : "Registrar venta"}
          </button>
        }
      />
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
          <button
            className={buttonClass}
            type="button"
            onClick={() => openMovement(moveFilter === "exit" ? "exit" : "entry")}
          >
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
            canSetPrice={premium}
            onChanged={() => reloadAll()}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-gray-900">Movimientos</h2>
              <p className="text-xs text-gray-500">
                Compras en verde, ventas en azul y reversos en ámbar.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">
                {visibleMovements.length}{" "}
                {visibleMovements.length === 1 ? "movimiento" : "movimientos"}
              </span>
              {moveFilter !== "exit" && (
                <button
                  className={movementActionClass("entry")}
                  type="button"
                  onClick={() => openMovement("entry")}
                >
                  <Icon>
                    <path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14" />
                  </Icon>
                  Registrar compra
                </button>
              )}
              {moveFilter !== "entry" && (
                <button
                  className={movementActionClass("exit")}
                  type="button"
                  onClick={() => openMovement("exit")}
                >
                  <Icon>
                    <path d="M12 20V8m0 0 5 5m-5-5-5 5M5 4h14" />
                  </Icon>
                  Registrar venta
                </button>
              )}
            </div>
          </div>

          <div
            role="group"
            aria-label="Tipo de movimiento"
            className="mt-3 inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1"
          >
            {MOVEMENT_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={moveFilter === filter.id}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  moveFilter === filter.id
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
                onClick={() => setMoveFilter(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <Status loading={movements.loading} error={movements.error} />
          {visibleMovements.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title={
                  (movements.data ?? []).length === 0
                    ? "Todavía no hay movimientos en esta tienda"
                    : "No hay movimientos de este tipo"
                }
                hint={
                  (movements.data ?? []).length === 0
                    ? "Las compras y ventas que registres van a aparecer acá."
                    : "Probá con otro filtro."
                }
              />
            </div>
          ) : (
            <MovementList
              movements={visibleMovements}
              canReverse={isAdmin}
              busy={busy}
              onReverse={(movement) => void onReverse(movement)}
            />
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
            {(isAdmin || premium) && (
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
                  isAdmin || premium
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
        <Modal
          title={mov.type === "entry" ? "Registrar compra" : "Registrar venta"}
          size="lg"
          onClose={() => setModal(null)}
        >
          <Status error={msg.error} />
          {premium ? (
            movementForm
          ) : (
            <PremiumLock
              title="Movimientos manuales"
              benefits={[
                "Registrar compras y ventas con varios productos en un solo ticket.",
                "Descuentos por venta y dashboard analítico del rango que elijas.",
                "Precios por producto en los pedidos y QR de vínculo masivo.",
              ]}
            >
              {movementForm}
            </PremiumLock>
          )}
        </Modal>
      )}

      {modal === "price" && (
        <Modal title="Publicar precio" size="sm" onClose={() => setModal(null)}>
          <Status error={msg.error} />
          {priceForm}
        </Modal>
      )}
    </section>
  );
}
