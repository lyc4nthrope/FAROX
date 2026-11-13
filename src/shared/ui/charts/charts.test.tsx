import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BarChart } from "./BarChart";
import { DonutChart } from "./DonutChart";
import { LineChart } from "./LineChart";

afterEach(cleanup);

describe("LineChart", () => {
  it("dibuja la leyenda y expone una descripción accesible", () => {
    render(
      <LineChart
        labels={["1 nov", "2 nov"]}
        series={[{ key: "sales", label: "Ventas", color: "#059669", values: [100, 200] }]}
        formatValue={(value) => `$${value}`}
        formatAxis={(value) => `$${value}`}
        ariaLabel="Ventas por día"
      />,
    );

    expect(screen.getByRole("img", { name: "Ventas por día" })).toBeInTheDocument();
    expect(screen.getByText("Ventas")).toBeInTheDocument();
  });

  it("muestra un estado vacío sin datos", () => {
    render(
      <LineChart
        labels={[]}
        series={[]}
        formatValue={(value) => String(value)}
        formatAxis={(value) => String(value)}
        ariaLabel="Sin datos"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Sin datos para graficar");
  });
});

describe("DonutChart", () => {
  it("dibuja la participación y su leyenda textual", () => {
    render(
      <DonutChart
        slices={[
          { key: "norte", label: "Norte", value: 75, color: "#059669" },
          { key: "sur", label: "Sur", value: 25, color: "#0ea5e9" },
        ]}
        centerLabel="Ventas"
        centerValue="$100"
        formatValue={(value) => `$${value}`}
        ariaLabel="Participación de ventas"
      />,
    );

    expect(screen.getByRole("img", { name: "Participación de ventas" })).toBeInTheDocument();
    expect(screen.getByText("Norte")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("avisa cuando no hay ventas", () => {
    render(
      <DonutChart
        slices={[{ key: "norte", label: "Norte", value: 0, color: "#059669" }]}
        centerLabel="Ventas"
        centerValue="$0"
        formatValue={(value) => `$${value}`}
        ariaLabel="Participación de ventas"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Sin ventas");
  });
});

describe("BarChart", () => {
  it("compara series por categoría con valores visibles", () => {
    render(
      <BarChart
        items={[
          { key: "norte", label: "Norte", values: [40, 60] },
          { key: "sur", label: "Sur", values: [20, 30] },
        ]}
        series={[
          { key: "purchases", label: "Compras", color: "#111827" },
          { key: "sales", label: "Ventas", color: "#059669" },
        ]}
        formatValue={(value) => `$${value}`}
        ariaLabel="Ventas por distribuidor"
      />,
    );

    expect(screen.getByRole("list", { name: "Ventas por distribuidor" })).toBeInTheDocument();
    expect(screen.getByText("Norte")).toBeInTheDocument();
    expect(screen.getAllByText("$60").length).toBeGreaterThan(0);
  });

  it("muestra un estado vacío cuando todo está en cero", () => {
    render(
      <BarChart
        items={[{ key: "norte", label: "Norte", values: [0] }]}
        series={[{ key: "sales", label: "Ventas", color: "#059669" }]}
        formatValue={(value) => String(value)}
        ariaLabel="Ventas por distribuidor"
        emptyText="Sin ventas"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Sin ventas");
  });
});
