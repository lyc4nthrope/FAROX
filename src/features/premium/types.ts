// 0032: estado de Premium y desglose de planes. El frontend NO calcula el
// precio a cobrar: quote_plan lo devuelve desde la DB.
export interface PremiumStatus {
  premium: boolean;
  premiumUntil: string | null;
  premiumGraceUntil: string | null;
  graceActive: boolean;
  needsStoreChoice: boolean;
  activeOwnedStores: number;
}

export interface PlanQuote {
  code: string;
  name: string;
  finalCents: number;
  baseCents: number;
  taxCents: number;
  mpFeeCents: number;
  netCents: number;
  currency: string;
  intervalMonths: number;
  taxIncluded: boolean;
  feePassedToCustomer: boolean;
  mpFeeBps: number;
  mpFeeFixedCents: number;
}

export interface OwnedStore {
  id: number;
  name: string;
  city: string | null;
  createdAt: string;
  isActive: boolean;
  deactivatedReason: string | null;
}

export type PremiumSubscriptionStatus =
  "pending" | "authorized" | "paused" | "cancelled" | "expired";

/** 0035/F4: suscripción propia (sin exponer ids del proveedor). */
export interface PremiumSubscription {
  id: number;
  status: PremiumSubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  planCode: string | null;
  planName: string | null;
}

export interface CreatedSubscription {
  initPoint: string;
  subscriptionId: number;
  reused: boolean;
}

// F5: panel admin de planes y precios.
export interface AdminPlan {
  id: number;
  code: string;
  name: string;
  amountCents: number;
  currency: string;
  intervalMonths: number;
  taxRateBps: number;
  taxIncluded: boolean;
  mpFeeBps: number;
  mpFeeFixedCents: number;
  mpFeeTaxBps: number;
  feePassedToCustomer: boolean;
  active: boolean;
  version: number;
}

export interface PlanVersionRow {
  version: number;
  amountCents: number;
  taxRateBps: number;
  taxIncluded: boolean;
  mpFeeBps: number;
  mpFeeFixedCents: number;
  mpFeeTaxBps: number;
  feePassedToCustomer: boolean;
  validFrom: string;
}

export interface PlanPreview {
  finalCents: number;
  baseCents: number;
  taxCents: number;
  mpFeeCents: number;
  netCents: number;
}

export interface PlanPricingInput {
  code: string;
  amountCents: number;
  taxRateBps: number;
  taxIncluded: boolean;
  mpFeeBps: number;
  mpFeeFixedCents: number;
  mpFeeTaxBps: number;
  feePassedToCustomer: boolean;
  active: boolean;
}

export interface AdminSubscriptionRow {
  id: number;
  userId: string;
  userName: string;
  userEmail: string | null;
  planCode: string | null;
  planName: string | null;
  status: PremiumSubscriptionStatus;
  priceCents: number;
  currency: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  providerSubscriptionId: string | null;
}

export interface AdminPaymentRow {
  id: number;
  userId: string;
  userName: string;
  userEmail: string | null;
  planCode: string | null;
  planName: string | null;
  status: "pending" | "approved" | "rejected" | "refunded" | "charged_back";
  amountCents: number;
  currency: string;
  providerPaymentId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface ReconciliationResult {
  checkedSubscriptions: number;
  checkedPayments: number;
  updated: number;
}

export interface PremiumHealth {
  stalePendingPayments: number;
  stalePendingSubscriptions: number;
  failedNotices: number;
  graceUsers: number;
  webhookEvents24h: number;
}
