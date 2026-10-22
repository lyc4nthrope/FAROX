import { describe, expect, it } from "vitest";

import { firstAllowedRoute, roleLabel, visibleNavItems } from "./navigation";

describe("visibleNavItems — derivación rol→nav, matriz SEC-01 (V0-5)", () => {
  it("admin ve las 7 entradas (4 entidades + Roles + Catálogos + Auditoría, sdd/admin-console T-C5/T-D2)", () => {
    expect(visibleNavItems("admin").map((item) => item.to)).toEqual([
      "/distributors",
      "/products",
      "/stores",
      "/users",
      "/roles",
      "/catalogs",
      "/audit",
    ]);
  });

  it("operador: distribuidores/productos/tiendas y SIN /users ni rutas admin nuevas (ADM-12.2)", () => {
    const visibles = visibleNavItems("operador").map((item) => item.to);
    expect(visibles).toEqual(["/distributors", "/products", "/stores"]);
    // La matriz negativa es la regla de negocio: ninguna entrada admin se
    // cuela por agregar items al nav. /audit es solo-admin: audit_read
    // exige my_role() = 'admin' (0006:330-332) — T-D2 / ADM-12.2.
    expect(visibles).not.toContain("/users");
    expect(visibles).not.toContain("/roles");
    expect(visibles).not.toContain("/catalogs");
    expect(visibles).not.toContain("/audit");
  });

  it("distribuidor: solo lectura de productos (V0-5) — las rutas admin nuevas tampoco", () => {
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
