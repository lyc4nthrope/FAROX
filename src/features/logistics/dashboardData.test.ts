import { describe, expect, it } from "vitest";

import {
  buildDailyPoints,
  daysBetween,
  distributorTotals,
  formatCompactNumber,
  formatMetricAxis,
  movingAverage,
  purchasesOf,
  salesByWeekday,
  salesOf,
  topDistributors,
  topSalesDays,
  totalPoint,
} from "./dashboardData";
import type { DashboardRow } from "./dashboardData";

const ROWS: DashboardRow[] = [
  {
    day: "2026-11-01",
    distributor_id: 1,
    entries_count: 2,
    exits_count: 1,
    entries_value: 100,
    exits_value: 50,
  },
  {
    day: "2026-11-01",
    distributor_id: 2,
    entries_count: 1,
    exits_count: 0,
    entries_value: 10,
    exits_value: 0,
  },
  {
    day: "2026-11-03",
    distributor_id: 1,
    entries_count: 0,
    exits_count: 2,
    entries_value: 0,
    exits_value: 80,
  },
  {
    day: "2026-11-04",
    distributor_id: 3,
    entries_count: 0,
    exits_count: 1,
    entries_value: 0,
    exits_value: 30,
  },
];

describe("dashboardData", () => {
  it("agrega por día y rellena los días sin movimiento", () => {
    const points = buildDailyPoints(ROWS, "2026-11-01", "2026-11-03");

    expect(points).toHaveLength(3);
    expect(points[0]).toMatchObject({
      day: "2026-11-01",
      entriesCount: 3,
      exitsCount: 1,
      entriesValue: 110,
      exitsValue: 50,
    });
    expect(points[1]).toMatchObject({
      day: "2026-11-02",
      entriesCount: 0,
      exitsCount: 0,
      entriesValue: 0,
      exitsValue: 0,
    });
    expect(points[2]).toMatchObject({
      day: "2026-11-03",
      entriesCount: 0,
      exitsCount: 2,
      entriesValue: 0,
      exitsValue: 80,
    });
  });

  it("rechaza rangos invertidos o mayores a 366 días", () => {
    expect(daysBetween("2026-11-03", "2026-11-01")).toBe(0);
    expect(daysBetween("2026-11-01", "2026-11-03")).toBe(3);
    expect(buildDailyPoints(ROWS, "2026-11-01", "2027-11-02")).toEqual([]);
  });

  it("suma los totales del período", () => {
    const points = buildDailyPoints(ROWS, "2026-11-01", "2026-11-03");
    expect(totalPoint(points)).toMatchObject({
      entriesCount: 3,
      exitsCount: 3,
      entriesValue: 110,
      exitsValue: 130,
    });
  });

  it("usa salidas para la red y entradas para el distribuidor", () => {
    const total = totalPoint(buildDailyPoints(ROWS, "2026-11-01", "2026-11-03"));

    expect(salesOf(total, "network", "value")).toBe(130);
    expect(salesOf(total, "network", "count")).toBe(3);
    expect(salesOf(total, "distributor", "value")).toBe(110);
    expect(salesOf(total, "distributor", "count")).toBe(3);
    expect(purchasesOf(total, "network", "value")).toBe(110);
    expect(purchasesOf(total, "distributor", "value")).toBeNull();
  });

  it("agrupa por distribuidor y conserva el alcance del rol", () => {
    const totals = distributorTotals(ROWS, { 1: "Norte", 2: "Sur", 3: "Centro" });

    expect(totals.map((item) => item.label)).toEqual(["Norte", "Centro", "Sur"]);
    expect(totals[0]).toMatchObject({ exitsValue: 130, exitsCount: 3 });
  });

  it("deja un grupo «Otros» cuando hay demasiadas categorías", () => {
    const totals = distributorTotals(ROWS, { 1: "Norte", 2: "Sur", 3: "Centro" });
    const top = topDistributors(totals, 2, true);

    expect(top).toHaveLength(2);
    expect(top[0]?.label).toBe("Norte");
    expect(top[1]).toMatchObject({
      label: "Otros (2)",
      exitsValue: 30,
      exitsCount: 1,
    });
  });

  it("calcula la participación por día de la semana", () => {
    const points = buildDailyPoints(ROWS, "2026-11-01", "2026-11-03");
    const network = salesByWeekday(points, "network", "value");
    const distributor = salesByWeekday(points, "distributor", "value");

    expect(network.map((bucket) => bucket.label)).toEqual([
      "Lun",
      "Mar",
      "Mié",
      "Jue",
      "Vie",
      "Sáb",
      "Dom",
    ]);
    expect(network.find((bucket) => bucket.label === "Dom")?.value).toBe(50);
    expect(network.find((bucket) => bucket.label === "Mar")?.value).toBe(80);
    expect(distributor.find((bucket) => bucket.label === "Dom")?.value).toBe(110);
  });

  it("ordena los mejores días por ventas", () => {
    const points = buildDailyPoints(ROWS, "2026-11-01", "2026-11-03");
    const best = topSalesDays(points, "network", "value", 2);

    expect(best.map((bucket) => bucket.key)).toEqual(["2026-11-03", "2026-11-01"]);
    expect(best[0]?.value).toBe(80);
  });

  it("calcula el promedio móvil con ventana parcial", () => {
    expect(movingAverage([10, 20, 30], 2)).toEqual([10, 15, 25]);
  });

  it("formatea montos compactos para los ejes", () => {
    expect(formatCompactNumber(999)).toBe("999");
    expect(formatCompactNumber(12_000)).toBe("12 k");
    expect(formatCompactNumber(1_200_000)).toBe("1,2 M");
    expect(formatMetricAxis(1_200_000, "value")).toBe("$1,2 M");
    expect(formatMetricAxis(12_000, "count")).toBe("12 k");
  });
});
