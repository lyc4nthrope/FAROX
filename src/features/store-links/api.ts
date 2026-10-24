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

/** URL que se codifica en el QR. */
export function linkUrl(code: string): string {
  return `${window.location.origin}/vincular/${encodeURIComponent(code)}`;
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
