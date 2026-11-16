import { describe, expect, it } from "vitest";

import { sortBySalesRanking } from "./ranking";

const OPTIONS = [
  { id: 1, name: "Arroz Diana" },
  { id: 2, name: "Leche Alpina" },
  { id: 3, name: "Café Ávila" },
];

describe("sortBySalesRanking · orden del ticket (0040)", () => {
  it("pone primero lo más vendido y deja los sin ventas alfabéticos al final", () => {
    const ranking = new Map([
      [2, 40],
      [3, 10],
    ]);

    expect(sortBySalesRanking(OPTIONS, ranking).map((option) => option.id)).toEqual([2, 3, 1]);
  });

  it("con ranking vacío ordena alfabéticamente", () => {
    expect(sortBySalesRanking(OPTIONS, new Map()).map((option) => option.name)).toEqual([
      "Arroz Diana",
      "Café Ávila",
      "Leche Alpina",
    ]);
  });

  it("no muta la lista original", () => {
    const original = [...OPTIONS];
    sortBySalesRanking(OPTIONS, new Map([[1, 5]]));
    expect(OPTIONS).toEqual(original);
  });
});
