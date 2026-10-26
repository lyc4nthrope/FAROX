import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";

// INV-05 (0017): QR de vínculo tienda ↔ distribuidor. El QR lleva la URL
// /vincular/<link_code>; el código solo se obtiene por RPC (dueño o admin).

type Err = { message: string } | null;

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
  /** null = el producto está en ambos catálogos pero no tiene precio activo. */
  price: number | null;
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

export async function unlinkDistributor(storeId: number, distributorId: number): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("unlink_distributor", {
    p_store: storeId,
    p_distributor: distributorId,
  });
  return { error };
}

export async function fetchLinkedDistributors(storeId: number): Promise<LoadResult<LinkedDistributor[]>> {
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
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: Number(r.product_id),
    name: String(r.name ?? ""),
    price: r.price == null ? null : Number(r.price),
  }));
  return { data: rows, error };
}
