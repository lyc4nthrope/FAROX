import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";

// INV-05 (0017): QR de vínculo tienda ↔ distribuidor. El QR lleva la URL
// /vincular/<link_code>; el código solo se obtiene por RPC (dueño o admin).

type Err = { message: string } | null;

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

export interface LinkedDistributor {
  distributor_id: number;
  name: string;
  created_at: string;
}

export interface StoreOption {
  id: number;
  name: string;
}

export interface LinkedDistributorOption {
  id: number;
  name: string;
}

export interface RequestableProduct {
  id: number;
  name: string;
  brand: string | null;
  quantity: number | null;
  /** null = el producto está en ambos catálogos pero no tiene precio activo. */
  price: number | null;
}

/** 0029: contacto de la contraparte vinculada. */
export type ContactKind = "distribuidor" | "store";

export interface CounterpartContact {
  full_name: string;
  phone_number: string | null;
  email: string | null;
  contact_preference: "whatsapp" | "phone" | "email";
}

export async function fetchCounterpartContact(
  kind: ContactKind,
  id: number,
): Promise<LoadResult<CounterpartContact[]>> {
  const { data, error } = await supabase.rpc("get_counterpart_contact", {
    p_kind: kind,
    p_id: id,
  });
  if (error !== null) {
    return { data: null, error };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((row): CounterpartContact => {
    const preference = row.contact_preference;
    return {
      full_name: typeof row.full_name === "string" ? row.full_name : "",
      phone_number: typeof row.phone_number === "string" ? row.phone_number : null,
      email: typeof row.email === "string" ? row.email : null,
      contact_preference:
        preference === "phone" || preference === "email"
          ? (preference as "phone" | "email")
          : "whatsapp",
    };
  });
  return { data: rows, error: null };
}

/** URL que se codifica en el QR. */
export function linkUrl(code: string): string {
  return `${window.location.origin}/vincular/${encodeURIComponent(code)}`;
}

/** Tiendas del operador autenticado (my_store_ids + stores activas). */
export async function fetchMyStoreOptions(): Promise<LoadResult<StoreOption[]>> {
  const scope = await supabase.rpc("my_store_ids");
  if (scope.error) return { data: null, error: scope.error };
  const ids = Array.isArray(scope.data)
    ? (scope.data as unknown[]).map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("stores")
    .select("id,name")
    .in("id", ids)
    .eq("is_active", true)
    .order("name")
    .limit(200);
  return { data: (data ?? []) as StoreOption[], error };
}

export async function getLinkCode(storeId: number): Promise<LoadResult<string>> {
  const { data, error } = await supabase.rpc("get_store_link_code", { p_store: storeId });
  return { data: typeof data === "string" ? data : null, error };
}

export async function regenerateLinkCode(storeId: number): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("regenerate_store_link_code", { p_store: storeId });
  return { error };
}

export async function linkToStore(code: string): Promise<{ data: number | null; error: Err }> {
  const { data, error } = await supabase.rpc("link_distributor_to_store", { p_code: code });
  return { data: data == null ? null : Number(data), error };
}

export async function unlinkDistributor(
  storeId: number,
  distributorId: number,
): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("unlink_distributor", {
    p_store: storeId,
    p_distributor: distributorId,
  });
  return { error };
}

export async function fetchLinkedDistributors(
  storeId: number,
): Promise<LoadResult<LinkedDistributor[]>> {
  const { data, error } = await supabase
    .from("store_distributors")
    .select("distributor_id,created_at,distributor:distributors(name)")
    .eq("store_id", storeId);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const rel = r.distributor as { name?: unknown } | null;
    return {
      distributor_id: Number(r.distributor_id),
      name: typeof rel?.name === "string" ? rel.name : "",
      created_at: String(r.created_at),
    };
  });
  return { data: rows, error };
}

/** Opciones para /pedidos/nuevo: solo los distribuidores vinculados a la tienda. */
export async function fetchLinkedDistributorOptions(
  storeId: number,
): Promise<LoadResult<LinkedDistributorOption[]>> {
  const result = await fetchLinkedDistributors(storeId);
  return {
    data:
      result.data === null
        ? null
        : result.data.map((l) => ({ id: l.distributor_id, name: l.name })),
    error: result.error,
  };
}

/**
 * Productos que la tienda y el distribuidor tienen a la vez. La RPC calcula la
 * intersección stock × distributor_products y devuelve el precio activo de la
 * tienda (o null si no hay). La RLS no deja leer distributor_products al
 * operador, por eso se usa la RPC y no una tabla directa.
 */
export async function fetchStoreDistributorProducts(
  storeId: number,
  distributorId: number,
): Promise<LoadResult<RequestableProduct[]>> {
  const { data, error } = await supabase.rpc("list_store_distributor_products", {
    p_store: storeId,
    p_distributor: distributorId,
  });
  if (error !== null) {
    return { data: null, error };
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.product_id),
    name: String(r.name ?? ""),
    price: r.price == null ? null : Number(r.price),
  }));
  if (rows.length === 0) {
    return { data: [], error: null };
  }

  // La RPC de intersección no expone marca/stock. Se completan con una lectura
  // de stock de la tienda (la misma RLS que ya usa el operador), para que el
  // selector pueda buscar por marca y filtrar por cantidad.
  const { data: stockData, error: stockError } = await supabase
    .from("stock")
    .select("product_id,quantity,product:products(brand:brands(name))")
    .eq("store_id", storeId)
    .in(
      "product_id",
      rows.map((row) => row.id),
    );
  if (stockError !== null) {
    return { data: null, error: stockError };
  }
  const meta = new Map<number, { brand: string | null; quantity: number | null }>();
  for (const raw of (stockData ?? []) as Record<string, unknown>[]) {
    meta.set(Number(raw.product_id), {
      brand: relBrand(raw.product),
      quantity: raw.quantity == null ? null : Number(raw.quantity),
    });
  }
  return {
    data: rows.map((row) => ({
      ...row,
      brand: meta.get(row.id)?.brand ?? null,
      quantity: meta.get(row.id)?.quantity ?? null,
    })),
    error: null,
  };
}
