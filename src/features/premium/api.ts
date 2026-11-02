import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";
import type {
  CreatedSubscription,
  OwnedStore,
  PlanQuote,
  PremiumStatus,
  PremiumSubscription,
  PremiumSubscriptionStatus,
} from "./types";

type Err = { message: string } | null;
type EdgeResult<T> = { data: T | null; error: Err };

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

const SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "authorized",
  "paused",
  "cancelled",
  "expired",
]);

function normalizeSubscription(raw: Record<string, unknown>): PremiumSubscription {
  const planRaw = raw["plan"];
  const planCandidate = Array.isArray(planRaw) ? planRaw[0] : planRaw;
  const plan =
    typeof planCandidate === "object" && planCandidate !== null
      ? (planCandidate as Record<string, unknown>)
      : {};
  const status =
    typeof raw.status === "string" && SUBSCRIPTION_STATUSES.has(raw.status)
      ? (raw.status as PremiumSubscriptionStatus)
      : "pending";
  return {
    id: asNumber(raw.id),
    status,
    cancelAtPeriodEnd: raw.cancel_at_period_end === true,
    currentPeriodEnd: asString(raw.current_period_end),
    planCode: asString(plan.code),
    planName: asString(plan.name),
  };
}

export async function fetchMySubscription(): Promise<LoadResult<PremiumSubscription | null>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id ?? null;
  if (userId === null) {
    return { data: null, error: null };
  }
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, status, cancel_at_period_end, current_period_end, plan:plans(code, name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error !== null) {
    return { data: null, error };
  }
  if (data === null) {
    return { data: null, error: null };
  }
  return { data: normalizeSubscription(data as Record<string, unknown>), error: null };
}

async function edgeErrorMessage(error: unknown): Promise<string> {
  if (typeof error === "object" && error !== null && "context" in error) {
    const context = (error as { context?: Response }).context;
    if (context !== undefined) {
      try {
        const payload: unknown = await context.clone().json();
        if (typeof payload === "object" && payload !== null && "error" in payload) {
          const message = (payload as { error?: unknown }).error;
          if (typeof message === "string" && message !== "") return message;
        }
      } catch {
        // El cuerpo no era JSON; se usa el mensaje genérico.
      }
    }
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message !== "") return message;
  }
  return "No se pudo completar la operación.";
}

async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<EdgeResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error !== null) {
    return { data: null, error: { message: await edgeErrorMessage(error) } };
  }
  return { data: data as T, error: null };
}

/** F4: crea el preapproval en Mercado Pago; devuelve el init_point. */
export async function createSubscription(
  planCode: string,
): Promise<EdgeResult<CreatedSubscription>> {
  const result = await invokeFunction<{
    init_point?: unknown;
    subscription_id?: unknown;
    reused?: unknown;
  }>("create-subscription", { plan_code: planCode });
  if (result.error !== null) return { data: null, error: result.error };
  const initPoint = asString(result.data?.init_point);
  if (initPoint === null) {
    return { data: null, error: { message: "No se pudo iniciar el pago." } };
  }
  return {
    data: {
      initPoint,
      subscriptionId: asNumber(result.data?.subscription_id),
      reused: result.data?.reused === true,
    },
    error: null,
  };
}

/** F4: cancela la renovación; el período pagado sigue vigente. */
export async function cancelSubscription(): Promise<{ error: Err }> {
  const result = await invokeFunction<unknown>("cancel-subscription", {});
  return { error: result.error };
}
