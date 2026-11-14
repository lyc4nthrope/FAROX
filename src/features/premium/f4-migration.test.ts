import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261029000035_f4_mercado_pago.sql"),
  "utf8",
);

describe("0035 · soporte Mercado Pago", () => {
  it("agrega external_reference y provider_init_point a subscriptions", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS external_reference text/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS provider_init_point text/);
  });

  it("external_reference es único y hay una sola suscripción activa por usuario", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_external_reference/);
    expect(sql).toMatch(/WHERE external_reference IS NOT NULL/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_one_active_per_user/);
    expect(sql).toMatch(/WHERE status IN \('pending', 'authorized', 'paused'\)/);
    expect(sql).toMatch(/row_number\(\) OVER/);
  });

  it("el merge de período no retrocede ni reautoriza una suscripción terminal", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.merge_subscription_period/);
    expect(sql).toMatch(/WHEN current_period_start IS NULL OR p_start > current_period_start/);
    expect(sql).toMatch(/WHEN current_period_end IS NULL OR p_end > current_period_end/);
    expect(sql).toMatch(/WHEN v_status IN \('cancelled', 'expired', 'paused'\) THEN v_status/);
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION[\s\S]*merge_subscription_period\(bigint, timestamptz, timestamptz\)[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
  });

  it("la activación por período usa GREATEST y no reduce premium_until", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.activate_premium_until/);
    expect(sql).toMatch(/premium_until = GREATEST\(COALESCE\(premium_until, now\(\)\), p_until\)/);
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION[\s\S]*activate_premium_until\(uuid, timestamptz, bigint\)[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
  });

  it("no abre escrituras nuevas al cliente", () => {
    expect(sql).not.toMatch(/GRANT .*INSERT.*authenticated/i);
    expect(sql).not.toMatch(/GRANT .*UPDATE.*authenticated/i);
  });
});
