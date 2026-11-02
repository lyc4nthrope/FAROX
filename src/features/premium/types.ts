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
  | "pending"
  | "authorized"
  | "paused"
  | "cancelled"
  | "expired";

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
