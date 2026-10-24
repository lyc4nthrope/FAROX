import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";

// DIST-02 pedidos + fiado (créditos/pagos). Escrituras solo por RPC:
// create_order, update_order_status, confirm_delivery, create_credit,
// register_payment, register_payment_reverse, cancel_credit.

type Err = { message: string } | null;

export type OrderStatus = "pending" | "in_route" | "delivered" | "cancelled";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Pendiente",
  in_route: "En ruta",
  delivered: "Entregado",
  cancelled: "Cancelado",
};

export interface OrderRow {
  id: number;
  status: OrderStatus;
  store_id: number;
  store_name: string;
  distributor_name: string;
  expected_at: string | null;
  delivered_at: string | null;
  created_at: string;
  notes: string | null;
  cancelled_reason: string | null;
}
export interface OrderItemRow {
  id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  received_quantity: number | null;
  status: string;
  unit_price: number | null;
}
export interface Option {
  id: number;
  name: string;
}
export interface CreditRow {
  id: number;
  order_id: number;
  store_name: string;
  total_amount: number;
  balance: number;
  status: string;
  due_date: string | null;
}
export interface PaymentRow {
  id: number;
  amount: number;
  payment_method: string;
  paid_at: string;
  reverso_of_id: number | null;
}

function relName(value: unknown): string {
  if (value !== null && typeof value === "object" && "name" in value) {
    const name = (value as { name: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

const ORDER_COLUMNS =
  "id,status,store_id,expected_at,delivered_at,created_at,notes,cancelled_reason,store:stores(name),distributor:distributors(name)";

function toOrder(r: Record<string, unknown>): OrderRow {
  return {
    id: Number(r.id),
    status: r.status as OrderStatus,
    store_id: Number(r.store_id),
    store_name: relName(r.store),
    distributor_name: relName(r.distributor),
    expected_at: (r.expected_at as string | null) ?? null,
    delivered_at: (r.delivered_at as string | null) ?? null,
    created_at: String(r.created_at),
    notes: (r.notes as string | null) ?? null,
    cancelled_reason: (r.cancelled_reason as string | null) ?? null,
  };
}

/** Lista visible según la RLS: admin todo, operador sus tiendas, distribuidor los suyos. */
export async function fetchOrders(status: OrderStatus | "all"): Promise<LoadResult<OrderRow[]>> {
  let query = supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  return { data: ((data ?? []) as Record<string, unknown>[]).map(toOrder), error };
}

export async function fetchOrder(orderId: number): Promise<LoadResult<OrderRow>> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .single();
  return { data: data ? toOrder(data as Record<string, unknown>) : null, error };
}

/** get_order_items omite unit_price para no Premium (D40). */
export async function fetchOrderItems(orderId: number): Promise<LoadResult<OrderItemRow[]>> {
  const { data, error } = await supabase.rpc("get_order_items", { p_order: orderId });
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    product_id: Number(r.product_id),
    product_name: String(r.product_name ?? ""),
    quantity: Number(r.quantity),
    received_quantity: r.received_quantity == null ? null : Number(r.received_quantity),
    status: String(r.status),
    unit_price: r.unit_price == null ? null : Number(r.unit_price),
  }));
  return { data: rows, error };
}

export async function fetchStoreOptions(isAdmin: boolean): Promise<LoadResult<Option[]>> {
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
  return { data: (data ?? []) as Option[], error };
}

export async function fetchDistributorOptions(): Promise<LoadResult<Option[]>> {
  const { data, error } = await supabase
    .from("distributors")
    .select("id,name")
    .eq("is_active", true)
    .order("name")
    .limit(200);
  return { data: (data ?? []) as Option[], error };
}

/** Productos asignados a la tienda (stock) — los únicos que tiene sentido pedir. */
export async function fetchStoreProducts(storeId: number): Promise<LoadResult<Option[]>> {
  const { data, error } = await supabase
    .from("stock")
    .select("product_id,product:products(name)")
    .eq("store_id", storeId)
    .limit(500);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.product_id),
    name: relName(r.product),
  }));
  return { data: rows, error };
}

export interface NewOrderInput {
  distributorId: number;
  storeId: number;
  items: { product_id: number; quantity: number }[];
  expectedAt: string | null;
  notes: string | null;
}

export async function createOrder(input: NewOrderInput): Promise<{ data: number | null; error: Err }> {
  const { data, error } = await supabase.rpc("create_order", {
    p_distributor: input.distributorId,
    p_store: input.storeId,
    p_items: input.items,
    p_expected_at: input.expectedAt,
    p_notes: input.notes,
  });
  return { data: typeof data === "number" ? data : data == null ? null : Number(data), error };
}

export async function updateOrderStatus(
  orderId: number,
  status: "in_route" | "cancelled",
  reason: string | null,
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("update_order_status", {
    p_order: orderId,
    p_status: status,
    p_reason: reason,
  });
  return { error };
}

export async function confirmDelivery(
  orderId: number,
  items: { product_id: number; received_quantity: number }[],
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("confirm_delivery", { p_order: orderId, p_items: items });
  return { error };
}

// ---------------------------------------------------------------- fiado

export async function fetchCredits(): Promise<LoadResult<CreditRow[]>> {
  const { data, error } = await supabase
    .from("credits")
    .select("id,order_id,total_amount,balance,status,due_date,store:stores(name)")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    order_id: Number(r.order_id),
    store_name: relName(r.store),
    total_amount: Number(r.total_amount),
    balance: Number(r.balance),
    status: String(r.status),
    due_date: (r.due_date as string | null) ?? null,
  }));
  return { data: rows, error };
}

export async function fetchPayments(creditId: number): Promise<LoadResult<PaymentRow[]>> {
  const { data, error } = await supabase
    .from("credit_payments")
    .select("id,amount,payment_method,paid_at,reverso_of_id")
    .eq("credit_id", creditId)
    .order("paid_at", { ascending: false });
  return { data: (data ?? []) as PaymentRow[], error };
}

export async function createCredit(orderId: number, dueDate: string | null): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("create_credit", { p_order: orderId, p_due_date: dueDate });
  return { error };
}

export async function registerPayment(
  creditId: number,
  amount: number,
  method: string,
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("register_payment", {
    p_credit: creditId,
    p_amount: amount,
    p_method: method,
  });
  return { error };
}

export async function reversePayment(paymentId: number, reason: string): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("register_payment_reverse", {
    p_payment: paymentId,
    p_reason: reason,
  });
  return { error };
}

export async function cancelCredit(creditId: number, reason: string): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("cancel_credit", { p_credit: creditId, p_reason: reason });
  return { error };
}
