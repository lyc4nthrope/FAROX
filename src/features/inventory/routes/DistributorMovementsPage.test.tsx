import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as inventoryApi from "../api";
import { DistributorMovementsPage } from "./DistributorMovementsPage";

vi.mock("../api", () => ({
  fetchDistributorMovements: vi.fn(),
}));

const MOVEMENTS: inventoryApi.MovementRow[] = [
  {
    id: 1,
    type: "entry",
    quantity: 12,
    created_at: "2026-10-28T10:00:00Z",
    product_name: "Arroz Diana",
    motive_name: "reabastecimiento",
    reverso_of_id: null,
    store_name: "Tienda Centro",
  },
  {
    id: 2,
    type: "exit",
    quantity: 2,
    created_at: "2026-10-28T11:00:00Z",
    product_name: "Leche Alpina",
    motive_name: "venta",
    reverso_of_id: null,
    store_name: "Tienda Norte",
  },
  {
    id: 3,
    type: "exit",
    quantity: 1,
    created_at: "2026-10-28T12:00:00Z",
    product_name: "Arroz Diana",
    motive_name: "ajuste",
    reverso_of_id: 1,
    store_name: "Tienda Centro",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inventoryApi.fetchDistributorMovements).mockResolvedValue({
    data: MOVEMENTS,
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("DistributorMovementsPage · historial del distribuidor (S15)", () => {
  it("reutiliza la lista de movimientos con la tienda de cada uno", async () => {
    render(<DistributorMovementsPage />);

    expect((await screen.findAllByText("Arroz Diana")).length).toBe(2);
    expect(screen.getByText("Leche Alpina")).toBeInTheDocument();
    expect(screen.getAllByText("Tienda Centro").length).toBe(2);
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    expect(screen.getByText("3 movimientos")).toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-tone", "entry");
    expect(items[1]).toHaveAttribute("data-tone", "exit");
    expect(items[2]).toHaveAttribute("data-tone", "reverse");
  });

  it("filtra entradas y salidas", async () => {
    render(<DistributorMovementsPage />);
    const user = userEvent.setup();

    await screen.findAllByText("Arroz Diana");
    await user.click(screen.getByRole("button", { name: "Entradas" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Arroz Diana")).toBeInTheDocument();
    expect(screen.queryByText("Leche Alpina")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Salidas" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Leche Alpina")).toBeInTheDocument();
  });

  it("sin movimientos muestra el estado vacío", async () => {
    vi.mocked(inventoryApi.fetchDistributorMovements).mockResolvedValue({
      data: [],
      error: null,
    });
    render(<DistributorMovementsPage />);

    expect(await screen.findByText("Todavía no hay movimientos")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });

  it("con un filtro sin resultados explica que pruebe otro", async () => {
    vi.mocked(inventoryApi.fetchDistributorMovements).mockResolvedValue({
      data: [MOVEMENTS[0]!],
      error: null,
    });
    render(<DistributorMovementsPage />);
    const user = userEvent.setup();

    await screen.findByText("Arroz Diana");
    await user.click(screen.getByRole("button", { name: "Salidas" }));
    expect(await screen.findByText("No hay movimientos de este tipo")).toBeInTheDocument();
  });
});
