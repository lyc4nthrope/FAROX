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

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261105000043_precios_masivos.sql`;

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ");
}

describe("0043 · carga masiva de precios de la tienda", () => {
  it("existe y crea la RPC por lote", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.set_store_prices_bulk( p_store bigint, p_lines jsonb ) RETURNS integer",
    );
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
  });

  it("exige admin/operador con la tienda en alcance y Premium", () => {
    const sql = readMigration();
    expect(sql).toContain("v_role NOT IN ('admin', 'operador')");
    expect(sql).toContain("p_store = ANY (public.my_store_ids())");
    expect(sql).toContain("IF NOT public.is_premium() THEN");
    expect(sql).toContain("publicar precios requiere Premium (D7)");
  });

  it("valida el lote y que cada producto esté asignado a la tienda", () => {
    const sql = readMigration();
    expect(sql).toContain("jsonb_typeof(p_lines) <> 'array'");
    expect(sql).toContain("jsonb_array_length(p_lines) > 500");
    expect(sql).toContain("FROM public.stock s");
    expect(sql).toContain("no está asignado a la tienda");
    expect(sql).toContain("el precio de compra debe ser > 0");
    expect(sql).toContain("el precio de venta debe ser > 0");
  });

  it("la venta desactiva la publicación anterior antes de insertar (índice único)", () => {
    const sql = readMigration();
    const deactivate = sql.indexOf("UPDATE public.price_publications SET is_active = false");
    const insert = sql.indexOf("INSERT INTO public.price_publications");
    expect(deactivate).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(deactivate);
    expect(sql).toContain(
      "WHERE product_id = v_line.product_id AND store_id = p_store AND is_active",
    );
  });

  it("la compra hace upsert y null borra el precio", () => {
    const sql = readMigration();
    expect(sql).toContain("INSERT INTO public.store_product_prices");
    expect(sql).toContain("ON CONFLICT (store_id, product_id) DO UPDATE");
    expect(sql).toContain("DELETE FROM public.store_product_prices");
  });

  it("solo escribe la columna marcada y rechaza productos repetidos", () => {
    const sql = readMigration();
    expect(sql).toContain("set_purchase boolean, set_sale boolean");
    expect(sql).toContain(
      "IF COALESCE(v_line.set_purchase, false) = false AND COALESCE(v_line.set_sale, false) = false THEN RAISE EXCEPTION 'set_store_prices_bulk: la fila del producto % no indica qué precio escribir', v_line.product_id; END IF;",
    );
    expect(sql).toContain("IF COALESCE(v_line.set_purchase, false) THEN");
    expect(sql).toContain("IF COALESCE(v_line.set_sale, false) THEN");
    expect(sql).toContain("count(DISTINCT (item->>'product_id'))");
    expect(sql).toContain("producto repetido en el lote");
  });

  it("la función nueva trae su GRANT explícito (deny-by-default de 0011)", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.set_store_prices_bulk(bigint, jsonb) TO authenticated",
    );
    expect(sql).toContain(
      "REVOKE EXECUTE ON FUNCTION public.set_store_prices_bulk(bigint, jsonb) FROM PUBLIC, anon",
    );
  });
});
