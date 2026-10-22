import { describe, expect, it } from "vitest";

import { mapError } from "./mapError";

// D7 (unidad): los 10 triggers de la tabla D5 / HARD-1, uno por uno, con los
// textos RAISE verificados en las migraciones (0004:318/376/552/555/559/581/
// 598/617/656 · 0011:66).
describe("mapError (D5 · HARD-1 — los 10 triggers)", () => {
  it("42501 (RLS / GRANT de columna)", () => {
    expect(
      mapError({ code: "42501", message: "permission denied for table products" }),
    ).toBe("No tenés permisos para esta operación.");
  });

  it("'solo admin' (RPC RAISE 0004:552/581/598/617 y assert_admin 0011:66)", () => {
    expect(mapError({ code: "P0001", message: "update_user_role: solo admin" })).toBe(
      "Solo un administrador puede hacer esto.",
    );
    expect(mapError({ message: "set_user_premium: solo admin" })).toBe(
      "Solo un administrador puede hacer esto.",
    );
    expect(mapError({ message: "solo admin" })).toBe(
      "Solo un administrador puede hacer esto.",
    );
  });

  it("M11 (0004:555 y su variante trigger 0004:318)", () => {
    expect(
      mapError({ message: "M11: rol distribuidor requiere distributor_id" }),
    ).toBe("El rol distribuidor requiere elegir un distribuidor.");
    expect(
      mapError({ message: "M11: el rol distribuidor requiere distributor_id" }),
    ).toBe("El rol distribuidor requiere elegir un distribuidor.");
  });

  it("'rol inexistente' (0004:559)", () => {
    expect(mapError({ message: "rol inexistente: superusuario" })).toBe(
      "El rol seleccionado no existe.",
    );
  });

  it("'store_type inexistente' (0004:656)", () => {
    expect(mapError({ message: "store_type inexistente: 999" })).toBe(
      "El tipo de tienda no existe.",
    );
  });

  it("D34 tope de tiendas (0004:376)", () => {
    expect(
      mapError({ message: "D34: tope de tiendas alcanzado (1 activas, tope 1)" }),
    ).toBe("Alcanzaste el tope de tiendas (1 activa; 3 con premium).");
  });

  it("23502 not_null (stores.location)", () => {
    expect(
      mapError({
        code: "23502",
        message: 'null value in column "location" violates not-null constraint',
      }),
    ).toBe("Faltan datos obligatorios (coordenadas).");
  });

  it("PGRST116 (.single() sin fila)", () => {
    expect(
      mapError({
        code: "PGRST116",
        message: "JSON object requested, multiple (or no) rows returned",
      }),
    ).toBe("No se encontró el registro.");
  });

  it("credenciales inválidas (auth de supabase-js)", () => {
    expect(mapError({ message: "Invalid login credentials" })).toBe(
      "Email o contraseña incorrectos.",
    );
  });

  it("red / timeout (fetch rechazado)", () => {
    expect(mapError(new TypeError("Failed to fetch"))).toBe(
      "No se pudo conectar, revisá tu conexión.",
    );
    expect(
      mapError(new Error("NetworkError when attempting to fetch resource.")),
    ).toBe("No se pudo conectar, revisá tu conexión.");
    expect(mapError(new Error("The operation timed out."))).toBe(
      "No se pudo conectar, revisá tu conexión.",
    );
  });

  it("fallback: el texto crudo JAMÁS se devuelve (HARD-1)", () => {
    expect(
      mapError({
        message:
          'column "role_id" is of type role_enum but expression is of type text',
      }),
    ).toBe("Ocurrió un error inesperado. Intentá de nuevo.");
    expect(mapError(null)).toBe("Ocurrió un error inesperado. Intentá de nuevo.");
    expect(mapError(undefined)).toBe("Ocurrió un error inesperado. Intentá de nuevo.");
    expect(mapError("algo falló")).toBe("Ocurrió un error inesperado. Intentá de nuevo.");
  });

  it("prevalencia D5: SQLSTATE gana sobre el substring de mensaje", () => {
    expect(
      mapError({ code: "42501", message: "D34: tope de tiendas alcanzado" }),
    ).toBe("No tenés permisos para esta operación.");
  });
});

// sdd/admin-console T-B1: los 3 mappings nuevos que users (lote B) y
// roles/catálogos (lote C) necesitan — texto exacto verificado contra el
// spec #598 (ADM-8.4, ADM-9.3/9.4, camino de error de ADM-5).
describe("mapError · sdd/admin-console T-B1 (23503, 23505, «usuario inexistente»)", () => {
  it("23503 FK RESTRICT (rol o registro en uso)", () => {
    expect(
      mapError({
        code: "23503",
        message: 'update or delete on table "users" violates foreign key constraint',
      }),
    ).toBe("Este registro está en uso y no se puede eliminar.");
  });

  it("23505 UNIQUE (nombre duplicado en catálogos)", () => {
    expect(
      mapError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "roles_name_key"',
      }),
    ).toBe("Ya existe un registro con ese nombre.");
  });

  it("'usuario inexistente' (RAISE de update_user_role/set_user_premium/set_user_active)", () => {
    expect(
      mapError({ code: "P0001", message: "update_user_role: usuario inexistente: u-404" }),
    ).toBe("No se encontró el usuario.");
    expect(mapError({ message: "set_user_premium: usuario inexistente: u-404" })).toBe(
      "No se encontró el usuario.",
    );
    expect(mapError({ message: "set_user_active: usuario inexistente: u-404" })).toBe(
      "No se encontró el usuario.",
    );
  });

  it("prevalencia T-B1: 23503/23505 ganan por SQLSTATE aunque el mensaje traiga otra pista", () => {
    expect(
      mapError({ code: "23503", message: "solo admin" }),
    ).toBe("Este registro está en uso y no se puede eliminar.");
    expect(
      mapError({ code: "23505", message: "duplicate key value (raw)" }),
    ).toBe("Ya existe un registro con ese nombre.");
  });
});
