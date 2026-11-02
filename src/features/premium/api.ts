import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";
import type { OwnedStore, PlanQuote, PremiumStatus } from "./types";

type Err = { message: string } | null;

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(raw: Record<string, unknown>): PremiumStatus {
  return {
    premium: raw.premium === true,
    premiumUntil: asString(raw.premium_until),
    premiumGraceUntil: asString(raw.premium_grace_until),
    graceActive: raw.grace_active === true,
    needsStoreChoice: raw.needs_store_choice === true,
    activeOwnedStores: asNumber(raw.active_owned_stores),
  };
}

export async function fetchMyPremiumStatus(): Promise<LoadResult<PremiumStatus>> {
  const { data, error } = await supabase.rpc("my_premium_status");
  if (error !== null) {
    return { data: null, error };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const first = rows[0];
  return { data: first === undefined ? null : normalizeStatus(first), error: null };
}

function normalizeQuote(raw: Record<string, unknown>): PlanQuote {
  return {
    code: typeof raw.code === "string" ? raw.code : "",
    name: typeof raw.name === "string" ? raw.name : "",
    finalCents: asNumber(raw.final_cents),
    baseCents: asNumber(raw.base_cents),
    taxCents: asNumber(raw.tax_cents),
    mpFeeCents: asNumber(raw.mp_fee_cents),
    netCents: asNumber(raw.net_cents),
    currency: typeof raw.currency === "string" ? raw.currency : "COP",
    intervalMonths: asNumber(raw.interval_months),
    taxIncluded: raw.tax_included === true,
    feePassedToCustomer: raw.fee_passed_to_customer === true,
    mpFeeBps: asNumber(raw.mp_fee_bps),
    mpFeeFixedCents: asNumber(raw.mp_fee_fixed_cents),
  };
}

export async function fetchPlanQuote(code: string): Promise<{ quote: PlanQuote | null; error: Err }> {
  const { data, error } = await supabase.rpc("quote_plan", { p_code: code });
  if (error !== null) {
    return { quote: null, error };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const first = rows[0];
  return { quote: first === undefined ? null : normalizeQuote(first), error: null };
}

function normalizeOwnedStore(raw: Record<string, unknown>): OwnedStore {
  return {
    id: asNumber(raw.id),
    name: typeof raw.name === "string" ? raw.name : "",
    city: asString(raw.city),
    createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
    isActive: raw.is_active === true,
    deactivatedReason: asString(raw.deactivated_reason),
  };
}

export async function fetchMyOwnedStores(): Promise<LoadResult<OwnedStore[]>> {
  const { data, error } = await supabase.rpc("my_owned_stores");
  if (error !== null) {
    return { data: null, error };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return { data: rows.map(normalizeOwnedStore), error: null };
}

export async function chooseStoreForFreePlan(storeId: number): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("choose_store_for_free_plan", { p_keep: storeId });
  return { error };
}

export async function reactivatePremiumStores(storeIds: readonly number[]): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("reactivate_premium_stores", { p_ids: storeIds });
  return { error };
}

/** 0034: el dueño reactiva una tienda que él mismo había desactivado. */
export async function reactivateStore(storeId: number): Promise<{ error: Err }> {
  const { error } = await supabase.rpc("reactivate_store", { p_store: storeId });
  return { error };
}
