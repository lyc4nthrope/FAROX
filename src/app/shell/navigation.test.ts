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
      "/roles",
      "/catalogs",
      "/audit",
    ]);
  });

  it("operador: operación diaria y SIN ninguna entrada solo-admin", () => {
    const visibles = visibleNavItems("operador").map((item) => item.to);
    expect(visibles).toEqual([
      "/distributors",
      "/products",
      "/stores",
      "/inventario",
      "/alertas",
      "/pedidos",
      "/fiado",
      "/dashboard",
    ]);
    for (const adminOnly of ["/users", "/roles", "/catalogs", "/audit", "/rutas"]) {
      expect(visibles).not.toContain(adminOnly);
    }
  });

  it("distribuidor: su ruta, sus pedidos, alertas, dashboard y productos (lectura)", () => {
    expect(visibleNavItems("distribuidor").map((item) => item.to)).toEqual([
      "/mi-ruta",
      "/pedidos",
      "/alertas",
      "/dashboard",
      "/products",
    ]);
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
  it("admin y operador entran por distribuidores; distribuidor por su ruta; sin rol por productos", () => {
    expect(firstAllowedRoute("admin").to).toBe("/distributors");
    expect(firstAllowedRoute("operador").to).toBe("/distributors");
    expect(firstAllowedRoute("distribuidor").to).toBe("/mi-ruta");
    expect(firstAllowedRoute(null).to).toBe("/products");
  });
});
