import fs from "node:fs";

import { describe, expect, it } from "vitest";

// La migración es la fuente de verdad: sin DB local no se puede ejecutar la RPC
// en el gate. Se verifica el contenido exacto; el comportamiento se valida al
// aplicarla en Supabase.
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261105000047_precios_masivos_distribuidor.sql`;

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ");
}

describe("0047 · carga masiva de precios del distribuidor", () => {
  it("crea la RPC del lote para el distribuidor", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.set_distributor_prices_bulk( p_lines jsonb ) RETURNS integer",
    );
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
  });

  it("valida rol, Premium, alcance y tamaño del lote", () => {
    const sql = readMigration();
    expect(sql).toContain("IF v_role <> 'distribuidor' THEN");
    expect(sql).toContain("IF NOT public.is_premium() THEN");
    expect(sql).toContain("v_dist := public.my_distributor_id();");
    expect(sql).toContain("jsonb_array_length(p_lines) > 500");
    expect(sql).toContain("producto repetido en el lote");
  });

  it("solo escribe la columna marcada y respeta el costo manual", () => {
    const sql = readMigration();
    expect(sql).toContain("set_purchase boolean, set_sale boolean");
    expect(sql).toContain(
      "purchase_price = CASE WHEN COALESCE(v_line.set_purchase, false) THEN v_line.purchase_price ELSE dp.purchase_price END",
    );
    expect(sql).toContain(
      "purchase_price_source = CASE WHEN NOT COALESCE(v_line.set_purchase, false) THEN dp.purchase_price_source WHEN v_line.purchase_price IS NULL THEN NULL WHEN dp.purchase_price IS DISTINCT FROM v_line.purchase_price THEN 'manual' WHEN dp.purchase_price_source IS NULL THEN 'manual' ELSE dp.purchase_price_source END",
    );
    expect(sql).toContain(
      "sale_price = CASE WHEN COALESCE(v_line.set_sale, false) THEN v_line.sale_price ELSE dp.sale_price END",
    );
    expect(sql).toContain("WHERE dp.distributor_id = v_dist AND dp.product_id = v_line.product_id");
  });

  it("la función nueva trae su GRANT explícito (deny-by-default de 0011)", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.set_distributor_prices_bulk(jsonb) TO authenticated",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.set_distributor_prices_bulk(jsonb) FROM PUBLIC, anon",
    );
  });
});
