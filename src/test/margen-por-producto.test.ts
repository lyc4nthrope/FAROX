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

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261105000046_margen_por_producto_y_costo_manual.sql`;

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ");
}

describe("0046 · margen por producto y costo manual", () => {
  it("guarda el margen de la tienda por producto en una tabla privada", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = readMigration();
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.store_product_margins (");
    expect(sql).toContain(
      "margin_pct numeric(6,2) NOT NULL CHECK (margin_pct >= 0 AND margin_pct <= 1000),",
    );
    expect(sql).toContain("PRIMARY KEY (store_id, product_id)");
    expect(sql).toContain(
      "CREATE POLICY store_product_margins_select ON public.store_product_margins",
    );
    expect(sql).toContain("GRANT SELECT ON public.store_product_margins TO authenticated;");
  });

  it("guarda el margen del distribuidor y el origen del costo", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "ALTER TABLE public.distributor_products ADD COLUMN IF NOT EXISTS margin_pct numeric(6,2) NULL;",
    );
    expect(sql).toContain(
      "ALTER TABLE public.distributor_products ADD COLUMN IF NOT EXISTS purchase_price_source text NULL;",
    );
    expect(sql).toContain(
      "ALTER TABLE public.store_product_prices ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';",
    );
    expect(sql).toContain(
      "ADD CONSTRAINT store_product_prices_source_check CHECK (source IN ('manual', 'movement', 'delivery'));",
    );
  });

  it("los RPC del margen por producto validan alcance y Premium", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.set_store_product_margin( p_product bigint, p_store bigint, p_margin numeric(6,2) ) RETURNS void",
    );
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.set_distributor_product_margin( p_product bigint, p_margin numeric(6,2) ) RETURNS void",
    );
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.set_store_product_margin(bigint, bigint, numeric), public.set_distributor_product_margin(bigint, numeric) TO authenticated",
    );
  });

  it("el costo aprendido se refresca y el manual nunca se pisa", () => {
    const sql = readMigration();
    expect(sql).toContain("VALUES (p_store, p_product, v_fill, auth.uid(), 'movement')");
    expect(sql).toContain("VALUES (o.store_id, it.product_id, v_price, auth.uid(), 'delivery')");
    expect(sql).toContain("WHERE public.store_product_prices.source <> 'manual'");
    expect(sql).toContain(
      "source = CASE WHEN public.store_product_prices.purchase_price IS DISTINCT FROM EXCLUDED.purchase_price THEN 'manual' ELSE public.store_product_prices.source END",
    );
    expect(sql).toContain(
      "purchase_price_source = CASE WHEN NOT v_premium THEN dp.purchase_price_source WHEN p_purchase_price IS NULL THEN NULL WHEN dp.purchase_price IS DISTINCT FROM p_purchase_price THEN 'manual' ELSE dp.purchase_price_source END",
    );
  });

  it("mantiene las alertas del distribuidor y protege los costos previos", () => {
    const sql = readMigration();
    expect(sql).toContain("PERFORM public.internal_eval_distributor_alert(v_dist, p_product);");
    // 0048: el backfill separa el costo aprendido (hay una compra con ese
    // unit_cost) del cargado a mano; antes congelaba todo como 'manual'.
    expect(sql).toContain("FROM public.distributor_purchases x");
    expect(sql).toContain("AND x.unit_cost = dp.purchase_price");
    expect(sql).toContain(") THEN 'movement'");
    expect(sql).toContain("ELSE 'manual'");
    expect(sql).not.toContain(
      "UPDATE public.distributor_products SET purchase_price_source = 'manual'",
    );
  });

  it("la sugerencia usa el margen del producto si existe", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "COALESCE( (SELECT spm.margin_pct FROM public.store_product_margins spm WHERE spm.store_id = p_store AND spm.product_id = p_product), public.internal_user_margin_pct(auth.uid()))",
    );
    expect(sql).toContain("public.internal_user_margin_pct(o.created_by)");
    expect(sql).toContain("COALESCE(dp.margin_pct, public.internal_user_margin_pct(auth.uid()))");
  });

  it("el distribuidor respeta su costo manual al comprar", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "purchase_price = CASE WHEN dp.purchase_price_source = 'manual' THEN dp.purchase_price ELSE v_line.unit_price END",
    );
    expect(sql).toContain(
      "purchase_price_source = CASE WHEN dp.purchase_price_source = 'manual' THEN 'manual' ELSE 'movement' END",
    );
  });
});
