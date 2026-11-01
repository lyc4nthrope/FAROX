import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import { fetchMyPremiumStatus, fetchPlanQuote } from "./api";

vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: { rpc: vi.fn() },
}));

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("premium api (0032)", () => {
  it("mapea my_premium_status", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          premium: true,
          premium_until: "2026-12-31T12:00:00Z",
          premium_grace_until: null,
          grace_active: false,
          needs_store_choice: false,
          active_owned_stores: 3,
        },
      ],
      error: null,
    });

    const result = await fetchMyPremiumStatus();

    expect(rpc).toHaveBeenCalledWith("my_premium_status");
    expect(result.data).toEqual({
      premium: true,
      premiumUntil: "2026-12-31T12:00:00Z",
      premiumGraceUntil: null,
      graceActive: false,
      needsStoreChoice: false,
      activeOwnedStores: 3,
    });
    expect(result.error).toBeNull();
  });

  it("mapea quote_plan en centavos", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          code: "premium_monthly",
          name: "Premium mensual",
          final_cents: 1000000,
          base_cents: 840336,
          tax_cents: 159664,
          mp_fee_cents: 134351,
          net_cents: 705985,
          currency: "COP",
          interval_months: 1,
          tax_included: true,
          fee_passed_to_customer: false,
          mp_fee_bps: 329,
          mp_fee_fixed_cents: 80000,
        },
      ],
      error: null,
    });

    const result = await fetchPlanQuote("premium_monthly");

    expect(rpc).toHaveBeenCalledWith("quote_plan", { p_code: "premium_monthly" });
    expect(result.quote).toMatchObject({
      finalCents: 1000000,
      taxCents: 159664,
      mpFeeCents: 134351,
      netCents: 705985,
      taxIncluded: true,
    });
  });

  it("propaga el error de la RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sin permisos" } });

    const result = await fetchPlanQuote("premium_monthly");

    expect(result.quote).toBeNull();
    expect(result.error).toEqual({ message: "sin permisos" });
  });
});
