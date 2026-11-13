import type { LoadResult } from "../../shared/hooks/useLoad";
import { supabase } from "../../shared/lib/supabase/client";
import type {
  AdminPaymentRow,
  AdminPlan,
  AdminSubscriptionRow,
  CreatedSubscription,
  OwnedStore,
  PlanPricingInput,
  PlanPreview,
  PlanQuote,
  PlanVersionRow,
  PremiumHealth,
  PremiumStatus,
  PremiumSubscription,
  PremiumSubscriptionStatus,
  ReconciliationResult,
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

export async function fetchPlanQuote(
  code: string,
): Promise<{ quote: PlanQuote | null; error: Err }> {
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

export async function reactivatePremiumStores(
  storeIds: readonly number[],
): Promise<{ error: Err }> {
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

function nestedRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "object" && candidate !== null
    ? (candidate as Record<string, unknown>)
    : null;
}

function normalizeAdminPlan(raw: Record<string, unknown>): AdminPlan {
  return {
    id: asNumber(raw.id),
    code: typeof raw.code === "string" ? raw.code : "",
    name: typeof raw.name === "string" ? raw.name : "",
    amountCents: asNumber(raw.amount_cents),
    currency: typeof raw.currency === "string" ? raw.currency : "COP",
    intervalMonths: asNumber(raw.interval_months),
    taxRateBps: asNumber(raw.tax_rate_bps),
    taxIncluded: raw.tax_included === true,
    mpFeeBps: asNumber(raw.mp_fee_bps),
    mpFeeFixedCents: asNumber(raw.mp_fee_fixed_cents),
    mpFeeTaxBps: asNumber(raw.mp_fee_tax_bps),
    feePassedToCustomer: raw.fee_passed_to_customer === true,
    active: raw.active === true,
    version: asNumber(raw.version),
  };
}

export async function fetchAdminPlans(): Promise<LoadResult<AdminPlan[]>> {
  const { data, error } = await supabase
    .from("plans")
    .select(
      "id, code, name, amount_cents, currency, interval_months, tax_rate_bps, tax_included, mp_fee_bps, mp_fee_fixed_cents, mp_fee_tax_bps, fee_passed_to_customer, active, version",
    )
    .order("code");
  if (error !== null) {
    return { data: null, error };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return { data: rows.map(normalizeAdminPlan), error: null };
}

function normalizePlanVersion(raw: Record<string, unknown>): PlanVersionRow {
  return {
    version: asNumber(raw.version),
    amountCents: asNumber(raw.amount_cents),
    taxRateBps: asNumber(raw.tax_rate_bps),
    taxIncluded: raw.tax_included === true,
    mpFeeBps: asNumber(raw.mp_fee_bps),
    mpFeeFixedCents: asNumber(raw.mp_fee_fixed_cents),
    mpFeeTaxBps: asNumber(raw.mp_fee_tax_bps),
    feePassedToCustomer: raw.fee_passed_to_customer === true,
    validFrom: typeof raw.valid_from === "string" ? raw.valid_from : "",
  };
}

export async function fetchPlanVersions(planId: number): Promise<LoadResult<PlanVersionRow[]>> {
  const { data, error } = await supabase
    .from("plan_versions")
    .select(
      "version, amount_cents, tax_rate_bps, tax_included, mp_fee_bps, mp_fee_fixed_cents, mp_fee_tax_bps, fee_passed_to_customer, valid_from",
    )
    .eq("plan_id", planId)
    .order("version", { ascending: false });
  if (error !== null) {
    return { data: null, error };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return { data: rows.map(normalizePlanVersion), error: null };
}

function normalizePreview(raw: Record<string, unknown>): PlanPreview {
  return {
    finalCents: asNumber(raw.final_cents),
    baseCents: asNumber(raw.base_cents),
    taxCents: asNumber(raw.tax_cents),
    mpFeeCents: asNumber(raw.mp_fee_cents),
    netCents: asNumber(raw.net_cents),
  };
}

export async function previewPlanQuote(input: {
  amountCents: number;
  taxRateBps: number;
  taxIncluded: boolean;
  mpFeeBps: number;
  mpFeeFixedCents: number;
  mpFeeTaxBps: number;
}): Promise<{ preview: PlanPreview | null; error: Err }> {
  const { data, error } = await supabase.rpc("preview_plan_quote", {
    p_amount_cents: input.amountCents,
    p_tax_rate_bps: input.taxRateBps,
    p_tax_included: input.taxIncluded,
    p_mp_fee_bps: input.mpFeeBps,
    p_mp_fee_fixed_cents: input.mpFeeFixedCents,
    p_mp_fee_tax_bps: input.mpFeeTaxBps,
  });
  if (error !== null) {
    return { preview: null, error };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  const first = rows[0];
  return { preview: first === undefined ? null : normalizePreview(first), error: null };
}

export async function updatePlanPricing(
  input: PlanPricingInput,
): Promise<{ version: number | null; error: Err }> {
  const { data, error } = await supabase.rpc("update_plan_pricing", {
    p_code: input.code,
    p_amount_cents: input.amountCents,
    p_tax_rate_bps: input.taxRateBps,
    p_tax_included: input.taxIncluded,
    p_mp_fee_bps: input.mpFeeBps,
    p_mp_fee_fixed_cents: input.mpFeeFixedCents,
    p_mp_fee_tax_bps: input.mpFeeTaxBps,
    p_fee_passed_to_customer: input.feePassedToCustomer,
    p_active: input.active,
  });
  if (error !== null) {
    return { version: null, error };
  }
  return { version: typeof data === "number" ? data : Number(data), error: null };
}

function normalizeAdminSubscription(raw: Record<string, unknown>): AdminSubscriptionRow {
  const plan = nestedRecord(raw.plan);
  const user = nestedRecord(raw.user);
  const status =
    typeof raw.status === "string" && SUBSCRIPTION_STATUSES.has(raw.status)
      ? (raw.status as PremiumSubscriptionStatus)
      : "pending";
  return {
    id: asNumber(raw.id),
    userId: typeof raw.user_id === "string" ? raw.user_id : "",
    userName: typeof user?.full_name === "string" ? user.full_name : "—",
    userEmail: asString(user?.email),
    planCode: asString(plan?.code),
    planName: asString(plan?.name),
    status,
    priceCents: asNumber(raw.price_cents_at_signup),
    currency: typeof raw.currency === "string" ? raw.currency : "COP",
    currentPeriodEnd: asString(raw.current_period_end),
    cancelAtPeriodEnd: raw.cancel_at_period_end === true,
    createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
    providerSubscriptionId: asString(raw.provider_subscription_id),
  };
}

export async function fetchAdminSubscriptions(
  limit = 50,
): Promise<LoadResult<AdminSubscriptionRow[]>> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "id, user_id, status, price_cents_at_signup, currency, current_period_end, cancel_at_period_end, created_at, provider_subscription_id, plan:plans(code,name), user:users(full_name,email)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error !== null) {
    return { data: null, error };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return { data: rows.map(normalizeAdminSubscription), error: null };
}

function normalizeAdminPayment(raw: Record<string, unknown>): AdminPaymentRow {
  const plan = nestedRecord(raw.plan);
  const user = nestedRecord(raw.user);
  const statuses = new Set(["pending", "approved", "rejected", "refunded", "charged_back"]);
  const status =
    typeof raw.status === "string" && statuses.has(raw.status)
      ? (raw.status as AdminPaymentRow["status"])
      : "pending";
  return {
    id: asNumber(raw.id),
    userId: typeof raw.user_id === "string" ? raw.user_id : "",
    userName: typeof user?.full_name === "string" ? user.full_name : "—",
    userEmail: asString(user?.email),
    planCode: asString(plan?.code),
    planName: asString(plan?.name),
    status,
    amountCents: asNumber(raw.amount_cents),
    currency: typeof raw.currency === "string" ? raw.currency : "COP",
    providerPaymentId: asString(raw.provider_payment_id),
    paidAt: asString(raw.paid_at),
    createdAt: typeof raw.created_at === "string" ? raw.created_at : "",
  };
}

export async function fetchAdminPayments(limit = 50): Promise<LoadResult<AdminPaymentRow[]>> {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, user_id, status, amount_cents, currency, provider_payment_id, paid_at, created_at, plan:plans(code,name), user:users(full_name,email)",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error !== null) {
    return { data: null, error };
  }
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return { data: rows.map(normalizeAdminPayment), error: null };
}

export async function adminCancelSubscription(subscriptionId: number): Promise<{ error: Err }> {
  const result = await invokeFunction<unknown>("admin-cancel-subscription", {
    subscription_id: subscriptionId,
  });
  return { error: result.error };
}

export async function adminRefundPayment(paymentId: number): Promise<{ error: Err }> {
  const result = await invokeFunction<unknown>("refund-payment", {
    payment_id: paymentId,
  });
  return { error: result.error };
}

export async function reconcileSubscriptions(): Promise<{
  result: ReconciliationResult | null;
  error: Err;
}> {
  const invocation = await invokeFunction<ReconciliationResult>("reconcile-subscriptions", {});
  return { result: invocation.data, error: invocation.error };
}

export async function fetchPremiumHealth(): Promise<LoadResult<PremiumHealth>> {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [pendingPayments, pendingSubscriptions, failedNotices, graceUsers, webhookEvents] =
    await Promise.all([
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("created_at", oneHourAgo),
      supabase
        .from("subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lt("created_at", oneHourAgo),
      supabase
        .from("premium_notices")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed"),
      supabase
        .from("users")
        .select("id", { count: "exact", head: true })
        .not("premium_grace_until", "is", null)
        .gt("premium_grace_until", now.toISOString()),
      supabase
        .from("payment_events")
        .select("id", { count: "exact", head: true })
        .gte("received_at", oneDayAgo),
    ]);

  const firstError =
    pendingPayments.error ??
    pendingSubscriptions.error ??
    failedNotices.error ??
    graceUsers.error ??
    webhookEvents.error;
  if (firstError !== null) {
    return { data: null, error: firstError };
  }

  return {
    data: {
      stalePendingPayments: pendingPayments.count ?? 0,
      stalePendingSubscriptions: pendingSubscriptions.count ?? 0,
      failedNotices: failedNotices.count ?? 0,
      graceUsers: graceUsers.count ?? 0,
      webhookEvents24h: webhookEvents.count ?? 0,
    },
    error: null,
  };
}
