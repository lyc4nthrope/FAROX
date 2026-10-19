import { describe, expect, it } from "vitest";

import { firstAllowedRoute, roleLabel, visibleNavItems } from "./navigation";

describe("visibleNavItems — derivación rol→nav, matriz SEC-01 (V0-5)", () => {
  it("admin ve las 4 entradas de entidad", () => {
    expect(visibleNavItems("admin").map((item) => item.to)).toEqual([
      "/distributors",
      "/products",
      "/stores",
      "/users",
    ]);
  });

  it("operador: distribuidores/productos/tiendas y SIN /users (V0-5)", () => {
    expect(visibleNavItems("operador").map((item) => item.to)).toEqual([
      "/distributors",
      "/products",
      "/stores",
    ]);
  });

  it("distribuidor: solo lectura de productos (V0-5)", () => {
    expect(visibleNavItems("distribuidor").map((item) => item.to)).toEqual(["/products"]);
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
  it("admin y operador entran por distribuidores; distribuidor y sin rol por productos", () => {
    expect(firstAllowedRoute("admin").to).toBe("/distributors");
    expect(firstAllowedRoute("operador").to).toBe("/distributors");
    expect(firstAllowedRoute("distribuidor").to).toBe("/products");
    expect(firstAllowedRoute(null).to).toBe("/products");
  });
});
