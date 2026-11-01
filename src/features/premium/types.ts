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
