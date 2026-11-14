import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Guardas estáticas de la migración 0032: el runner no tiene Postgres, así que
// las invariantes que causaron overflow/RLS se fijan leyendo el SQL.
const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261029000032_premium_estado_planes.sql"),
  "utf8",
);

describe("0032 · invariantes de SQL", () => {
  it("multiplica en numeric antes de castear (annual 10.000.000 × 329 no entra en int4)", () => {
    expect(sql).toMatch(/v_base := round\(v_final::numeric \* 10000/);
    expect(sql).toMatch(/v_tax := round\(v_base::numeric \* p\.tax_rate_bps/);
    expect(sql).toMatch(/v_fee := round\(v_final::numeric \* p\.mp_fee_bps/);
    expect(sql).toMatch(/v_fee_tax := round\(v_fee::numeric \* p\.mp_fee_tax_bps/);
    expect(sql).not.toMatch(/v_final\s*\*\s*p\.mp_fee_bps/);
    expect(sql).not.toMatch(/v_base\s*\*\s*p\.tax_rate_bps/);
  });

  it("la policy anon de planes no llama my_role()", () => {
    expect(sql).toMatch(
      /CREATE POLICY plans_select_anon ON public\.plans\s+FOR SELECT TO anon\s+USING \(active\);/,
    );
    expect(sql).not.toMatch(
      /CREATE POLICY plans_select ON public\.plans\s+FOR SELECT TO anon, authenticated[\s\S]*?public\.my_role\(\)/,
    );
  });

  it("activate_premium usa el nombre p_payment_id que espera la Edge Function", () => {
    expect(sql).toMatch(/p_payment_id bigint DEFAULT NULL/);
    expect(sql).not.toMatch(/p_payment bigint/);
  });

  it("siembra los precios confirmados", () => {
    expect(sql).toMatch(/'premium_monthly', 'Premium mensual', 1000000/);
    expect(sql).toMatch(/'premium_annual', 'Premium anual', 10000000/);
    expect(sql).toMatch(/mp_fee_fixed_cents integer NOT NULL DEFAULT 80000/);
  });

  it("la gracia solo se deriva cuando no hay Premium activo", () => {
    expect(sql).toMatch(/WHEN public\.is_premium\(\) THEN NULL/);
    expect(sql).toMatch(/NOT is_premium AND grace_until > now\(\)/);
  });
});
