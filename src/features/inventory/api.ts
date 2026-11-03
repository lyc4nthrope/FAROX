import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";

// Inventario por tienda: movimientos (register_entry/exit, register_reverse),
// precios (set_price) y selectores de productos asignados. El catálogo y la
// asignación viven en la feature products (StoreCatalogPanel) desde 0024.
// Toda escritura va por RPC; las lecturas las filtra la RLS por rol/alcance.

type Err = { message: string } | null;

export interface StoreOption {
  id: number;
  name: string;
}
export interface StockOptionRow {
  product_id: number;
  product_name: string;
  brand: string | null;
  quantity: number;
  /** 0037: código de barras para el escáner del ticket. */
  barcode?: string | null;
}
export interface MovementRow {
  id: number;
  type: "entry" | "exit";
  quantity: number;
  created_at: string;
  product_name: string;
  motive_name: string;
  reverso_of_id: number | null;
  /** 0028: tienda del movimiento (solo la vista del distribuidor la muestra). */
  store_name?: string | null;
  /** 0029: precio de la operación y pedido que la originó (si aplica). */
  unit_price?: number | null;
  order_id?: number | null;
  /** 0029: dirección desde la perspectiva del usuario (venta del distribuidor). */
  direction?: "entry" | "exit";
  /** 0037: descuento porcentual aplicado a la venta (auditoría). */
  discount_pct?: number | null;
  /** 0037: origen de la fila; las compras del distribuidor no son movements. */
  source?: "movement" | "purchase";
}
/** 0037: opción de producto para el ticket de movimientos. */
export interface MovementProductOption {
  id: number;
  name: string;
  brand: string | null;
  barcode: string | null;
  /** Stock actual (tienda o catálogo del distribuidor), si se conoce. */
  quantity: number | null;
  /** Precio sugerido: venta o compra según el tipo de ticket. */
  purchasePrice: number | null;
  salePrice: number | null;
}
export interface MotiveOption {
  id: number;
  name: string;
  suggested_type: "entry" | "exit" | null;
}
export interface PriceRow {
  product_id: number;
  product_name: string;
  price: number;
  currency: string;
}

function relName(value: unknown): string {
  if (value !== null && typeof value === "object" && "name" in value) {
    const name = (value as { name: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

/** Marca embebida en product: { brand: { name } }. */
function relBrand(value: unknown): string | null {
  if (value === null || typeof value !== "object" || !("brand" in value)) return null;
  const brand = relName((value as { brand: unknown }).brand);
  return brand === "" ? null : brand;
}

/** Código de barras embebido en product, si viene en el select. */
function relBarcode(value: unknown): string | null {
  if (value === null || typeof value !== "object" || !("barcode" in value)) return null;
  const barcode = (value as { barcode: unknown }).barcode;
  return typeof barcode === "string" && barcode.trim() !== "" ? barcode.trim() : null;
}

/** Tiendas sobre las que el usuario opera: admin todas; operador su alcance. */
export async function fetchMyStores(isAdmin: boolean): Promise<LoadResult<StoreOption[]>> {
  let ids: number[] | null = null;
  if (!isAdmin) {
    const scope = await supabase.rpc("my_store_ids");
    if (scope.error) return { data: null, error: scope.error };
    ids = Array.isArray(scope.data) ? (scope.data as number[]) : [];
    if (ids.length === 0) return { data: [], error: null };
  }
  let query = supabase.from("stores").select("id,name").eq("is_active", true).order("name");
  if (ids !== null) query = query.in("id", ids);
  const { data, error } = await query.limit(200);
  return { data: (data ?? []) as StoreOption[], error };
}

export async function fetchStoreName(storeId: number): Promise<LoadResult<string>> {
  const { data, error } = await supabase
    .from("stores")
    .select("name")
    .eq("id", storeId)
    .maybeSingle();
  return { data: data ? String((data as { name: unknown }).name) : null, error };
}

/**
 * Productos asignados a la tienda para los selectores de movimiento y precio.
 * No se pagina: el formulario necesita poder elegir cualquier producto asignado,
 * no solo los de la página visible del inventario.
 */
export async function fetchStockOptions(storeId: number): Promise<LoadResult<StockOptionRow[]>> {
  const { data, error } = await supabase
    .from("stock")
    .select("product_id,quantity,product:products(name, barcode, brand:brands(name))")
    .eq("store_id", storeId)
    .order("product_id")
    .limit(500);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_id: Number(r.product_id),
    product_name: relName(r.product),
    brand: relBrand(r.product),
    quantity: Number(r.quantity),
    barcode: relBarcode(r.product),
  }));
  return { data: rows, error };
}

export async function fetchMovements(storeId: number): Promise<LoadResult<MovementRow[]>> {
  const { data, error } = await supabase
    .from("movements")
    .select("id,type,quantity,created_at,reverso_of_id,product:products(name),motive:motives(name)")
    .eq("store_id", storeId)
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    type: r.type as "entry" | "exit",
    quantity: Number(r.quantity),
    created_at: String(r.created_at),
    reverso_of_id: r.reverso_of_id === null ? null : Number(r.reverso_of_id),
    product_name: relName(r.product),
    motive_name: relName(r.motive),
  }));
  return { data: rows, error };
}

/**
 * 0028: movimientos visibles para el distribuidor (RLS por distributor_id).
 * Incluye la tienda para que el historial tenga contexto.
 */
export async function fetchDistributorMovements(): Promise<LoadResult<MovementRow[]>> {
  const { data, error } = await supabase
    .from("movements")
    .select(
      "id,type,quantity,unit_price,discount_pct,order_id,created_at,reverso_of_id,product:products(name),motive:motives(name),store:stores(name)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const type = r.type as "entry" | "exit";
    return {
      id: Number(r.id),
      type,
      // Venta/entrega para el distribuidor: la fila es entry para la tienda,
      // pero desde su lado es una salida. Un reverso conserva su tono propio.
      direction: type === "entry" ? ("exit" as const) : ("entry" as const),
      quantity: Number(r.quantity),
      unit_price: r.unit_price == null ? null : Number(r.unit_price),
      discount_pct: r.discount_pct == null ? null : Number(r.discount_pct),
      order_id: r.order_id == null ? null : Number(r.order_id),
      created_at: String(r.created_at),
      reverso_of_id: r.reverso_of_id === null ? null : Number(r.reverso_of_id),
      product_name: relName(r.product),
      motive_name: relName(r.motive),
      store_name: relName(r.store),
      source: "movement" as const,
    };
  });
  return { data: rows, error };
}

/**
 * 0037: compras propias del distribuidor. Se presentan como entradas en la
 * misma lista que los movimientos de tienda.
 */
export async function fetchDistributorPurchases(): Promise<LoadResult<MovementRow[]>> {
  const { data, error } = await supabase
    .from("distributor_purchases")
    .select("id,quantity,unit_cost,expiry_date,created_at,product:products(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    type: "entry" as const,
    direction: "entry" as const,
    quantity: Number(r.quantity),
    unit_price: r.unit_cost == null ? null : Number(r.unit_cost),
    created_at: String(r.created_at),
    reverso_of_id: null,
    product_name: relName(r.product),
    motive_name: "Compra a proveedor",
    store_name: null,
    source: "purchase" as const,
  }));
  return { data: rows, error };
}

/** 0037: catálogo del distribuidor con stock y precios para el ticket. */
export async function fetchDistributorMovementOptions(): Promise<
  LoadResult<MovementProductOption[]>
> {
  const { data, error } = await supabase
    .from("distributor_products")
    .select(
      "product_id,quantity,purchase_price,sale_price,product:products!inner(name,is_active,barcode,brand:brands(name))",
    )
    .order("product_id")
    .limit(500);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.product_id),
    name: relName(r.product),
    brand: relBrand(r.product),
    barcode: relBarcode(r.product),
    quantity: r.quantity == null ? null : Number(r.quantity),
    purchasePrice: r.purchase_price == null ? null : Number(r.purchase_price),
    salePrice: r.sale_price == null ? null : Number(r.sale_price),
  }));
  return { data: rows, error };
}

/** 0029: tiendas vinculadas a la distribuidora (para la venta directa). */
export interface DistributorStoreOption {
  id: number;
  name: string;
}

export async function fetchDistributorStores(): Promise<LoadResult<DistributorStoreOption[]>> {
  const { data, error } = await supabase
    .from("store_distributors")
    .select("store_id,store:stores(name)")
    .limit(200);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.store_id),
    name: relName(r.store),
  }));
  return { data: rows.sort((a, b) => a.name.localeCompare(b.name, "es")), error };
}

export interface DistributorSaleInput {
  storeId: number;
  productId: number;
  quantity: number;
  unitPrice: number;
  expiryDate: string | null;
}

/** 0029: venta directa del distribuidor a una tienda vinculada. */
export async function registerDistributorSale(
  input: DistributorSaleInput,
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("register_distributor_sale", {
    p_product: input.productId,
    p_store: input.storeId,
    p_qty: input.quantity,
    p_unit_price: input.unitPrice,
    p_expiry_date: input.expiryDate,
  });
  return { error };
}

/** 0037: una línea del ticket (venta o compra). */
export interface MovementLineInput {
  productId: number;
  quantity: number;
  /** Precio unitario NETO (ya con descuento). null = sin precio. */
  unitPrice: number | null;
  expiryDate?: string | null;
}

function linesPayload(lines: readonly MovementLineInput[]): Record<string, unknown>[] {
  return lines.map((line) => ({
    product_id: line.productId,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    expiry_date: line.expiryDate ?? null,
  }));
}

/** 0037: ticket de entradas/salidas de una tienda (admin/operador). */
export async function registerMovementsBulk(input: {
  storeId: number;
  type: "entry" | "exit";
  motiveId: number;
  lines: readonly MovementLineInput[];
  discountPct: number | null;
}): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("register_movements_bulk", {
    p_store: input.storeId,
    p_type: input.type,
    p_motive_id: input.motiveId,
    p_lines: linesPayload(input.lines),
    p_discount: input.discountPct,
  });
  return { error };
}

/** 0037: ticket de venta del distribuidor a una tienda vinculada. */
export async function registerDistributorSalesBulk(input: {
  storeId: number;
  lines: readonly MovementLineInput[];
  discountPct: number | null;
}): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("register_distributor_sales_bulk", {
    p_store: input.storeId,
    p_lines: linesPayload(input.lines),
    p_discount: input.discountPct,
  });
  return { error };
}

/** 0037: ticket de compra del distribuidor (suma stock propio). */
export async function registerDistributorPurchasesBulk(input: {
  lines: readonly MovementLineInput[];
}): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("register_distributor_purchases", {
    p_lines: linesPayload(input.lines),
  });
  return { error };
}

export async function fetchMotives(): Promise<LoadResult<MotiveOption[]>> {
  const { data, error } = await supabase
    .from("motives")
    .select("id,name,suggested_type")
    .eq("is_active", true)
    .order("name");
  return { data: (data ?? []) as MotiveOption[], error };
}

export async function fetchPrices(storeId: number): Promise<LoadResult<PriceRow[]>> {
  const { data, error } = await supabase
    .from("price_publications")
    .select("product_id,price,currency,product:products(name)")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .limit(500);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_id: Number(r.product_id),
    product_name: relName(r.product),
    price: Number(r.price),
    currency: String(r.currency),
  }));
  return { data: rows, error };
}

export interface MovementInput {
  type: "entry" | "exit";
  storeId: number;
  productId: number;
  quantity: number;
  /** 0027: precio de compra (entrada) o de venta (salida). null = derivado. */
  unitPrice: number | null;
  motiveId: number;
  expiryDate: string | null;
}

export async function registerMovement(input: MovementInput): Promise<{ error: Err }> {
  if (input.type === "entry") {
    const { error } = await supabase.rpc("register_entry", {
      p_product: input.productId,
      p_store: input.storeId,
      p_qty: input.quantity,
      p_motive_id: input.motiveId,
      p_order_id: null,
      p_expiry_date: input.expiryDate,
      p_unit_price: input.unitPrice,
    });
    return { error };
  }
  const { error } = await supabase.rpc("register_exit", {
    p_product: input.productId,
    p_store: input.storeId,
    p_qty: input.quantity,
    p_motive_id: input.motiveId,
    p_order_id: null,
    p_unit_price: input.unitPrice,
  });
  return { error };
}

export async function reverseMovement(movementId: number, reason: string): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("register_reverse", {
    p_movement_id: movementId,
    p_reason: reason,
  });
  return { error };
}

export async function setPrice(
  storeId: number,
  productId: number,
  price: number,
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("set_price", {
    p_product: productId,
    p_store: storeId,
    p_price: price,
    p_currency: "COP",
  });
  return { error };
}
