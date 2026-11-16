import { describe, expect, it } from "vitest";

import { clamp, formatShare, linePath, niceScale, pickLabelIndices } from "./chartMath";

describe("chartMath", () => {
  it("calcula una escala con pasos legibles", () => {
    expect(niceScale(120)).toEqual({
      max: 150,
      ticks: [0, 50, 100, 150],
    });
  });

  it("no divide por cero cuando no hay datos", () => {
    const scale = niceScale(0);
    expect(scale.max).toBeGreaterThan(0);
    expect(scale.ticks[0]).toBe(0);
    expect(scale.ticks.at(-1)).toBe(scale.max);
  });

  it("reparte las etiquetas del eje sin amontonarlas", () => {
    expect(pickLabelIndices(30, 6)).toEqual([0, 6, 12, 17, 23, 29]);
    expect(pickLabelIndices(4, 6)).toEqual([0, 1, 2, 3]);
  });

  it("arma el path de una línea", () => {
    expect(
      linePath(
        [10, 20],
        (index) => index * 10,
        (value) => value * 10,
      ),
    ).toBe("M0.00,100.00 L10.00,200.00");
  });

  it("formatea participaciones en es-CO", () => {
    expect(formatShare(1, 4)).toBe("25%");
    expect(formatShare(1, 3)).toBe("33,3%");
    expect(formatShare(0, 0)).toBe("0%");
  });

  it("limita valores al rango pedido", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });
});
