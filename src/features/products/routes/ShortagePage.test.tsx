import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as productsApi from "../api";
import type { ShortageRow } from "../types";
import { ShortagePage } from "./ShortagePage";

vi.mock("../api", () => ({
  fetchShortageProducts: vi.fn(),
}));

const FILA: ShortageRow = {
  store_id: 7,
  store_name: "Tienda Centro",
  product_id: 1,
  name: "Café molido",
  brand: "Andina",
  unit: "Gramos",
  category: "Bebidas",
  quantity: 0,
  base_quantity: 500,
};

describe("ShortagePage (S7 · faltantes por tienda)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("agrupa los faltantes por tienda", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({
      data: [
        { ...FILA, store_id: 8, store_name: "Almacén Norte", product_id: 2, name: "Arroz" },
        FILA,
      ],
      error: null,
    });

    render(<ShortagePage />);

    expect(await screen.findByRole("heading", { name: "Almacén Norte" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Tienda Centro" })).toBeInTheDocument();
    expect(screen.getByText("Café molido")).toBeInTheDocument();
    expect(screen.getByText("Arroz")).toBeInTheDocument();
  });

  it("distingue sin stock de reponer y muestra el stock contra la base", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({
      data: [FILA, { ...FILA, product_id: 3, name: "Yerba", quantity: 120 }],
      error: null,
    });

    render(<ShortagePage />);

    expect(await screen.findByText("Sin stock")).toBeInTheDocument();
    expect(await screen.findByText("Reponer")).toBeInTheDocument();
    expect(await screen.findByText("0 / 500")).toBeInTheDocument();
    expect(await screen.findByText("120 / 500")).toBeInTheDocument();
  });

  it("sin faltantes: estado vacío explícito", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({ data: [], error: null });

    render(<ShortagePage />);

    expect(await screen.findByText("No hay faltantes marcados")).toBeInTheDocument();
  });

  it("el error se muestra mapeado, nunca el texto crudo (HARD-1)", async () => {
    const denied = {
      code: "42501",
      message: "permission denied for function list_shortage_products",
    };
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({
      data: null,
      error: denied,
    });

    render(<ShortagePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});
