import { describe, expect, it } from "vitest";

import { firstAllowedRoute, roleLabel, visibleNavItems } from "./navigation";

describe("visibleNavItems — derivación rol→nav, matriz SEC-01 (V0-5)", () => {
  it("admin ve todas las entradas, incluidas las de operación y las solo-admin", () => {
    expect(visibleNavItems("admin").map((item) => item.to)).toEqual([
      "/distributors",
      "/products",
      "/stores",
      "/inventario",
      "/alertas",
      "/pedidos",
      "/fiado",
      "/rutas",
      "/dashboard",
      "/users",
      "/planes",
      "/pagos",
      "/roles",
      "/catalogs",
      "/audit",
    ]);
  });

  it("operador: operación diaria primero y SIN ninguna entrada solo-admin", () => {
    const visibles = visibleNavItems("operador").map((item) => item.to);
    expect(visibles).toEqual([
      "/inventario",
      "/pedidos",
      "/alertas",
      "/fiado",
      "/distributors",
      "/dashboard",
    ]);
    for (const adminOnly of [
      "/users",
      "/planes",
      "/pagos",
      "/roles",
      "/catalogs",
      "/audit",
      "/rutas",
    ]) {
      expect(visibles).not.toContain(adminOnly);
    }
    // 0024: Productos se fusionó en Inventario.
    expect(visibles).not.toContain("/products");
  });

  it("distribuidor: su ruta, sus pedidos y su catálogo, en orden de uso", () => {
    expect(visibleNavItems("distribuidor").map((item) => item.to)).toEqual([
      "/mi-ruta",
      "/pedidos",
      "/movimientos",
      "/products",
      "/alertas",
      "/dashboard",
    ]);
    // 0023: los faltantes pasaron a ser del operador; el distribuidor se
    // entera por el pedido, no por una vista de faltantes.
    expect(visibleNavItems("distribuidor").map((item) => item.to)).not.toContain("/faltantes");
    // El asistente vive en el widget flotante, no como entrada de nav.
    expect(visibleNavItems("distribuidor").map((item) => item.to)).not.toContain("/asistente");
    // Vincular tienda es contextual (Perfil + estados vacíos), no nav fijo.
    expect(visibleNavItems("distribuidor").map((item) => item.to)).not.toContain("/vincular");
  });

  it("sin rol (my_role() NULL): cero controles privilegiados (V0-3)", () => {
    expect(visibleNavItems(null).map((item) => item.to)).toEqual(["/products"]);
  });
});

describe("roleLabel", () => {
  it("mapea cada rol a su etiqueta y el ausente a 'Sin rol'", () => {
    expect(roleLabel("admin")).toBe("Administrador");
    expect(roleLabel("operador")).toBe("Operador");
    expect(roleLabel("distribuidor")).toBe("Distribuidor");
    expect(roleLabel(null)).toBe("Sin rol");
  });
});

describe("firstAllowedRoute (Home §S2)", () => {
  it("admin entra por distribuidores, operador por inventario, distribuidor por su ruta y sin rol por productos", () => {
    expect(firstAllowedRoute("admin").to).toBe("/distributors");
    expect(firstAllowedRoute("operador").to).toBe("/inventario");
    expect(firstAllowedRoute("distribuidor").to).toBe("/mi-ruta");
    expect(firstAllowedRoute(null).to).toBe("/products");
  });
});
