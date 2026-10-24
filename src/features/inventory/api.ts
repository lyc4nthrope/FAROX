import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";

// Inventario por tienda: asignación (stock), movimientos (register_entry/exit,
// register_reverse), precios (set_price) y alertas abiertas de la tienda.
// Toda escritura va por RPC; las lecturas las filtra la RLS por rol/alcance.

type Err = { message: string } | null;

export interface StoreOption {
  id: number;
  name: string;
}
export interface StockRow {
  product_id: number;
  product_name: string;
  quantity: number;
  threshold: number | null;
  expiry_date: string | null;
}
export interface MovementRow {
  id: number;
  type: "entry" | "exit";
  quantity: number;
  created_at: string;
  product_name: string;
  motive_name: string;
  reverso_of_id: number | null;
}
export interface MotiveOption {
  id: number;
  name: string;
  suggested_type: "entry" | "exit" | null;
}
export interface ProductOption {
  id: number;
  name: string;
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

export async function fetchStock(storeId: number): Promise<LoadResult<StockRow[]>> {
  const { data, error } = await supabase
    .from("stock")
    .select("product_id,quantity,threshold,expiry_date,product:products(name)")
    .eq("store_id", storeId)
    .order("product_id")
    .limit(500);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_id: Number(r.product_id),
    product_name: relName(r.product),
    quantity: Number(r.quantity),
    threshold: r.threshold === null ? null : Number(r.threshold),
    expiry_date: (r.expiry_date as string | null) ?? null,
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

export async function fetchMotives(): Promise<LoadResult<MotiveOption[]>> {
  const { data, error } = await supabase
    .from("motives")
    .select("id,name,suggested_type")
    .eq("is_active", true)
    .order("name");
  return { data: (data ?? []) as MotiveOption[], error };
}

export async function fetchActiveProducts(): Promise<LoadResult<ProductOption[]>> {
  const { data, error } = await supabase
    .from("products")
    .select("id,name")
    .eq("is_active", true)
    .order("name")
    .limit(500);
  return { data: (data ?? []) as ProductOption[], error };
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

export async function assignProduct(
  storeId: number,
  productId: number,
  threshold: number | null,
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("assign_product_to_store", {
    p_product: productId,
    p_store: storeId,
    p_threshold: threshold,
  });
  return { error };
}

export interface MovementInput {
  type: "entry" | "exit";
  storeId: number;
  productId: number;
  quantity: number;
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
    });
    return { error };
  }
  const { error } = await supabase.rpc("register_exit", {
    p_product: input.productId,
    p_store: input.storeId,
    p_qty: input.quantity,
    p_motive_id: input.motiveId,
    p_order_id: null,
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
