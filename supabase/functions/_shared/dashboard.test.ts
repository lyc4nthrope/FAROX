// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  resolvePeriod,
  summarizeDashboard,
  type DashboardRow,
} from "./dashboard";

const NOW = new Date("2026-11-12T15:30:00Z");

const ROWS: DashboardRow[] = [
  {
    day: "2026-11-01",
    distributor_id: 1,
    entries_count: 2,
    exits_count: 1,
    entries_value: 1000,
    exits_value: 500,
  },
  {
    day: "2026-11-01",
    distributor_id: 2,
    entries_count: 1,
    exits_count: 2,
    entries_value: 300,
    exits_value: 700,
  },
  {
    day: "2026-11-02",
    distributor_id: 1,
    entries_count: 0,
    exits_count: 3,
    entries_value: 0,
    exits_value: 900,
  },
];

describe("resolvePeriod", () => {
  it("resuelve hoy en UTC", () => {
    expect(resolvePeriod("today", undefined, undefined, NOW)).toEqual({
      from: "2026-11-12",
      to: "2026-11-12",
    });
  });

  it("resuelve el mes en curso desde el día 1", () => {
    expect(resolvePeriod("month", undefined, undefined, NOW)).toEqual({
      from: "2026-11-01",
      to: "2026-11-12",
    });
  });

  it("resuelve el mes pasado completo", () => {
    expect(resolvePeriod("last_month", undefined, undefined, NOW)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("cruza el año en enero", () => {
    expect(
      resolvePeriod("last_month", undefined, undefined, new Date("2026-01-15T12:00:00Z")),
    ).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("acepta un rango custom válido", () => {
    expect(resolvePeriod("custom", "2026-11-01", "2026-11-12", NOW)).toEqual({
      from: "2026-11-01",
      to: "2026-11-12",
    });
  });

  it("rechaza un rango invertido, inválido o mayor a 366 días", () => {
    expect(resolvePeriod("custom", "2026-11-12", "2026-11-01", NOW)).toHaveProperty("error");
    expect(resolvePeriod("custom", "2026-13-01", "2026-11-12", NOW)).toHaveProperty("error");
    expect(resolvePeriod("custom", "2025-01-01", "2026-11-12", NOW)).toHaveProperty("error");
    expect(resolvePeriod("custom", undefined, undefined, NOW)).toHaveProperty("error");
  });
});

describe("summarizeDashboard", () => {
  it("para admin/operador: ventas = salidas y compras = entradas", () => {
    const summary = summarizeDashboard(ROWS, "network", "2026-11-01", "2026-11-02", {
      1: "Norte",
      2: "Sur",
    });

    expect(summary.sales).toEqual({ value: 2100, count: 6, label: "salidas" });
    expect(summary.purchases).toEqual({ value: 1300, count: 3, label: "entradas" });
    expect(summary.by_month).toEqual([
      {
        month: "2026-11",
        sales_value: 2100,
        sales_count: 6,
        purchases_value: 1300,
        purchases_count: 3,
      },
    ]);
    expect(summary.top_days).toEqual([
      { day: "2026-11-01", sales_value: 1200, sales_count: 3 },
      { day: "2026-11-02", sales_value: 900, sales_count: 3 },
    ]);
    expect(summary.top_distributors).toEqual([
      { id: 1, name: "Norte", sales_value: 1400, sales_count: 4 },
      { id: 2, name: "Sur", sales_value: 700, sales_count: 2 },
    ]);
  });

  it("para distribuidor: ventas = entradas y no hay compras ni ranking", () => {
    const summary = summarizeDashboard(ROWS, "distributor", "2026-11-01", "2026-11-02", {});

    expect(summary.sales).toEqual({ value: 1300, count: 3, label: "ventas a tiendas" });
    expect(summary.purchases).toBeNull();
    expect(summary.top_distributors).toEqual([]);
  });

  it("devuelve ceros y listas vacías sin movimientos", () => {
    const summary = summarizeDashboard([], "network", "2026-11-01", "2026-11-02", {});
    expect(summary.sales).toEqual({ value: 0, count: 0, label: "salidas" });
    expect(summary.purchases).toEqual({ value: 0, count: 0, label: "entradas" });
    expect(summary.by_month).toEqual([]);
    expect(summary.top_days).toEqual([]);
    expect(summary.top_distributors).toEqual([]);
  });
});
