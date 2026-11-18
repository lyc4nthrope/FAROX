import { describe, expect, it } from "vitest";

import { formatQtyUnit, saleUnit } from "./format";

describe("unidades de venta (0059)", () => {
  it("un producto empacado se muestra en paquetes aunque su medida sea L", () => {
    expect(saleUnit(false, "Litro")).toBe("und");
    expect(formatQtyUnit(18, saleUnit(false, "Litro"))).toBe("18 und");
  });

  it("un producto a granel conserva kg o L", () => {
    expect(saleUnit(true, "Kilogramo")).toBe("kg");
    expect(saleUnit(true, "Litro")).toBe("L");
    expect(formatQtyUnit(1.5, saleUnit(true, "Kilogramo"))).toBe("1,5 kg");
  });

  it("sin dato de modo conserva la unidad original", () => {
    expect(saleUnit(undefined, "Unidad")).toBe("und");
    expect(saleUnit(undefined, "Kilogramo")).toBe("kg");
  });
});
