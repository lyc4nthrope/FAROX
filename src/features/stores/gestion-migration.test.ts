import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/20261029000034_gestion_tiendas.sql"),
  "utf8",
);

describe("0034 · gestión de tiendas", () => {
  it("desactivar exige dueño/admin y bloquea pedidos abiertos", () => {
    expect(sql).toMatch(/deactivate_store: no sos dueño de la tienda/);
    expect(sql).toMatch(/o\.status IN \('pending', 'in_route'\)/);
    expect(sql).toMatch(/deactivated_reason = CASE/);
  });

  it("reactivar respeta la razón y serializa el tope por usuario", () => {
    expect(sql).toMatch(/reactivate_store: renová Premium para reactivar tiendas pausadas por plan/);
    expect(sql).toMatch(
      /IF v_role <> 'admin' AND v_reason IS DISTINCT FROM 'user_removed' THEN/,
    );
    expect(sql).toMatch(
      /pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(auth\.uid\(\)::text, 0\)\s*\)/,
    );
  });

  it("transferir mueve created_by y user_stores, y valida el tope del nuevo dueño", () => {
    expect(sql).toMatch(/PERFORM public\.assert_admin\(\)/);
    expect(sql).toMatch(/SET created_by = p_new_owner/);
    expect(sql).toMatch(/DELETE FROM public\.user_stores/);
    expect(sql).toMatch(/INSERT INTO public\.user_stores/);
    expect(sql).toMatch(/public\.user_is_premium\(p_new_owner\)/);
    expect(sql).toMatch(/v_active >= v_cap/);
    expect(sql).toMatch(
      /pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(p_new_owner::text, 0\)\s*\)/,
    );
  });

  it("solo los roles autenticados pueden ejecutar las RPC", () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION[\s\S]*public\.transfer_store\(bigint, uuid\)[\s\S]*TO authenticated/,
    );
    expect(sql).toMatch(/FROM PUBLIC, anon/);
  });

  it("el UPDATE directo de stores no puede tocar is_active ni created_by", () => {
    expect(sql).toMatch(/REVOKE UPDATE ON public\.stores FROM authenticated/);
    expect(sql).toMatch(
      /column_name IN \(\s*'name', 'store_type_id', 'address', 'city', 'phone',\s*'location', 'website_url', 'country'\s*\)/,
    );
  });
});
