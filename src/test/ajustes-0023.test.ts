import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// La migración es la fuente de verdad: sin Postgres local no se puede ejecutar
// la RPC en el gate. Se verifica el contenido exacto; el comportamiento se
// valida al aplicarla en Supabase (SQL Editor).
const REPO_ROOT = decodeURIComponent(new URL("../../", import.meta.url).pathname)
  .replace(/^\/[A-Za-z]:\/@fs\/([A-Za-z]:)\//, "$1/")
  .replace(/^\/@fs\//, "/")
  .replace(/^\/([A-Za-z]:)/, "$1")
  .replace(/\/$/, "");

const MIGRATIONS_DIR = `${REPO_ROOT}/supabase/migrations`;
const PATH_0023 = `${MIGRATIONS_DIR}/20261026000023_faltantes_operador_y_fiado.sql`;

function readMigration(): string {
  return fs.readFileSync(PATH_0023, "utf8").replace(/\s+/g, " ");
}

describe("0023 · faltantes del operador y fiado del operador", () => {
  it("se aplica después de 0022 (orden por nombre)", () => {
    expect(fs.existsSync(PATH_0023)).toBe(true);
    const names = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(names.indexOf("20261026000023_faltantes_operador_y_fiado.sql")).toBeGreaterThan(
      names.indexOf("20261025000022_catalogo_operador.sql"),
    );
  });

  it("el distribuidor deja de ver faltantes: ni vínculo ni error, cero filas", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.list_shortage_products() RETURNS TABLE (",
    );
    // Ya no resuelve por vínculo de distribuidor (lo hacía 0022).
    expect(sql).not.toContain("store_distributors");
    expect(sql).not.toContain("my_distributor_id");
    // Admin: todas; operador: sus tiendas.
    expect(sql).toContain("IF v_role = 'admin' THEN");
    expect(sql).toContain("IF v_role = 'operador' THEN");
    expect(sql).toContain("s.store_id = ANY (public.my_store_ids())");
    // El resto recibe el conjunto vacío, no una excepción.
    expect(sql).toContain("RETURN; END; $$;");
    expect(sql).not.toContain("shortage: sin alcance");
  });

  it("el fiado acepta al operador solo en la tienda del pedido", () => {
    const sql = readMigration();
    expect(sql).toContain(
      "CREATE OR REPLACE FUNCTION public.create_credit( p_order bigint, p_due_date date DEFAULT NULL ) RETURNS bigint",
    );
    expect(sql).toContain("IF v_role NOT IN ('admin', 'operador') THEN");
    expect(sql).toContain(
      "IF v_role = 'operador' AND NOT (v_store = ANY (public.my_store_ids())) THEN",
    );
    expect(sql).toContain("create_credit: tienda fuera del alcance del operador");
    // Se conservan las reglas de negocio de 0004.
    expect(sql).toContain("ya tiene un crédito vigente (D15)");
    expect(sql).toContain("pedido sin líneas con monto > 0");
  });

  it("re-otorga ejecución sin PUBLIC/anon y con las dos firmas", () => {
    const sql = readMigration();
    const grant = /GRANT EXECUTE ON FUNCTION([\s\S]*?)TO ([a-zA-Z_,\s]+);/.exec(sql);
    expect(grant).not.toBeNull();
    expect(grant?.[1].match(/public\.[a-z_]+\(/g)).toHaveLength(2);
    expect(grant?.[2]).not.toContain("anon");
    expect(grant?.[2]).not.toContain("PUBLIC");
    expect(grant?.[2].split(",")).toHaveLength(2);

    const revoke = /REVOKE EXECUTE ON FUNCTION([\s\S]*?)FROM ([a-zA-Z_,\s]+);/.exec(sql);
    expect(revoke?.[2]).toContain("PUBLIC");
    expect(revoke?.[2]).toContain("anon");
  });

  it("ambas funciones son SECURITY DEFINER con search_path fijo", () => {
    const sql = readMigration();
    expect(sql.match(/SECURITY DEFINER SET search_path = pg_catalog, public/g)).toHaveLength(2);
    expect(path.basename(PATH_0023)).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });
});
