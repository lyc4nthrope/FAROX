import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261029000033_downgrade_tiendas.sql"),
  "utf8",
);

describe("0033 · invariantes de SQL", () => {
  it("my_store_ids excluye tiendas inactivas", () => {
    expect(sql).toMatch(/JOIN public\.stores s ON s\.id = us\.store_id AND s\.is_active/);
  });

  it("elegir tienda pausa las demás con la razón del plan", () => {
    expect(sql).toMatch(/deactivated_reason = 'premium_expired'/);
    expect(sql).toMatch(/AND id <> p_keep/);
  });

  it("reactivar exige Premium y respeta el tope de 3", () => {
    expect(sql).toMatch(/reactivate_premium_stores: requiere Premium/);
    expect(sql).toMatch(/v_active \+ array_length\(v_ids, 1\) > 3/);
    expect(sql).not.toMatch(/ARRAY\(SELECT DISTINCT unnest\(p_ids\)\)/);
    expect(sql).toMatch(/pg_advisory_xact_lock/);
  });

  it("el job conserva la más antigua y pausa el resto", () => {
    const start = sql.indexOf("FUNCTION public.job_scan_premium_downgrade");
    const end = sql.indexOf("REVOKE EXECUTE ON FUNCTION public.job_scan_premium_downgrade");
    const job = sql.slice(start, end);
    expect(job).toMatch(/row_number\(\) OVER/);
    expect(job).toMatch(/ORDER BY created_at, id/);
    expect(job).toMatch(/c\.rn > 1/);
    expect(job).toMatch(/COALESCE\(u\.premium_grace_until, u\.premium_until \+ interval '7 days'\) <= now\(\)/);
    expect(job).toMatch(/s2\.created_by = v_user AND s2\.is_active\) > 1/);
    expect(job).toMatch(/pg_catalog\.pg_advisory_xact_lock/);
  });
});
