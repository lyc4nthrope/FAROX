import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261029000036_f5_avisos_admin.sql"),
  "utf8",
);

describe("0036 · avisos y operación admin", () => {
  it("crea el outbox idempotente de avisos", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.premium_notices/);
    expect(sql).toMatch(/UNIQUE \(user_id, kind, period_key\)/);
    expect(sql).toMatch(/renewal_7/);
    expect(sql).toMatch(/grace_ending/);
    expect(sql).toMatch(/downgraded/);
    expect(sql).toMatch(/payment_failed/);
    expect(sql).toMatch(/cancellation/);
  });

  it("agrega rotación de conciliación a pagos y suscripciones", () => {
    expect(sql).toMatch(/ALTER TABLE public\.payments[\s\S]*ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_payments_pending_reconcile/);
    expect(sql).toMatch(/ALTER TABLE public\.subscriptions[\s\S]*ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS idx_subscriptions_active_reconcile/);
  });

  it("solo el admin lee avisos y el cliente no escribe", () => {
    expect(sql).toMatch(/CREATE POLICY premium_notices_select/);
    expect(sql).toMatch(/public\.my_role\(\) = 'admin'/);
    expect(sql).toMatch(/REVOKE ALL ON public\.premium_notices FROM anon, authenticated/);
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE).*premium_notices.*authenticated/i);
  });

  it("el preview de precios usa el mismo cálculo server-side", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.preview_plan_quote/);
    expect(sql).toMatch(/v_base := round\(v_final::numeric \* 10000/);
    expect(sql).toMatch(/v_fee := round\(v_final::numeric \* p_mp_fee_bps/);
    expect(sql).toMatch(/v_net := v_final - v_tax - v_fee/);
  });

  it("el enqueue es idempotente y no ejecutable por el cliente", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.enqueue_premium_notices/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, kind, period_key\) DO NOTHING/);
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.enqueue_premium_notices\(\)[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
  });
});
