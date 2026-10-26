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

const MIGRATION_PATH = `${REPO_ROOT}/supabase/migrations/20261025000021_store_distributor_requests.sql`;

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, "utf8").replace(/\s+/g, " ");
}

describe("0021 · solicitudes a distribuidores vinculados", () => {
  it("existe y crea la RPC de intersección de catálogos", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.list_store_distributor_products( p_store bigint, p_distributor bigint ) RETURNS TABLE (product_id bigint, name text, price numeric)",
    );
    expect(sql).toContain("FROM public.distributor_products dp");
    expect(sql).toContain("JOIN public.stock s");
    expect(sql).toContain(
      "LEFT JOIN public.price_publications pp ON pp.store_id = p_store AND pp.product_id = p.id AND pp.is_active",
    );
  });

  it("la RPC exige vínculo y alcance del operador, sin abrirla a otros roles", () => {
    const sql = readMigration();
    expect(sql).toContain("v_role NOT IN ('admin', 'operador')");
    expect(sql).toContain("p_store = ANY (public.my_store_ids())");
    expect(sql).toContain("FROM public.store_distributors sd");
    expect(sql).toContain("distribuidor no está vinculado a la tienda");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = pg_catalog, public");
  });

  it("create_order repite el vínculo y la intersección para el operador", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.create_order( p_distributor bigint, p_store bigint, p_items jsonb, p_expected_at timestamptz DEFAULT NULL, p_notes text DEFAULT NULL )",
    );
    expect(sql).toContain("el distribuidor % no está vinculado a la tienda %");
    expect(sql).toContain("producto % no está en el catálogo del distribuidor %");
    expect(sql).toContain("producto % no está en el catálogo de la tienda %");
    // El admin conserva el flujo global: las dos guardas viven bajo el rol operador.
    expect(sql).toContain("IF v_role = 'operador' THEN");
    expect(sql).toContain("SECURITY DEFINER");
  });

  it("mantiene el precio activo y no relaja la validación existente", () => {
    const sql = readMigration();
    expect(sql).toContain("sin precio activo para producto % en tienda %");
    expect(sql).toContain("producto repetido en items");
    expect(sql).toContain("quantity debe ser > 0");
    expect(sql).toContain("GET DIAGNOSTICS v_count = ROW_COUNT");
  });
});
