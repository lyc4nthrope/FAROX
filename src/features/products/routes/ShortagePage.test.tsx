import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as storeLinksApi from "../../store-links/api";
import * as productsApi from "../api";
import type { ShortageRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { ShortagePage } from "./ShortagePage";

vi.mock("../api", () => ({
  fetchShortageProducts: vi.fn(),
}));
vi.mock("../../store-links/api", () => ({
  fetchLinkedDistributorOptions: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
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

function renderPage(role: RoleName = "operador") {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter>
      <AuthProvider>
        <ShortagePage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ShortagePage (0023 · faltantes del operador)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(storeLinksApi.fetchLinkedDistributorOptions).mockResolvedValue({
      data: [{ id: 9, name: "Distribuidora Andes" }],
      error: null,
    });
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

    renderPage("admin");

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

    renderPage("admin");

    expect(await screen.findByText("Sin stock")).toBeInTheDocument();
    expect(await screen.findByText("Reponer")).toBeInTheDocument();
    expect(await screen.findByText("0 / 500")).toBeInTheDocument();
    expect(await screen.findByText("120 / 500")).toBeInTheDocument();
  });

  it("sin faltantes: estado vacío explícito", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({ data: [], error: null });

    renderPage("admin");

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

    renderPage("admin");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });

  // S3: el operador pide los faltantes a un distribuidor vinculado y el pedido
  // llega con los productos ya elegidos.
  it("operador: solicita los faltantes al distribuidor elegido con los productos preseleccionados", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({
      data: [FILA, { ...FILA, product_id: 4, name: "Panela" }],
      error: null,
    });

    renderPage("operador");

    // El distribuidor se autoselecciona cuando llega la lista. El <select> sin
    // opción vacía reporta el primer valor del DOM antes de que React aplique
    // el estado, así que el href es la fuente de verdad.
    const link = await screen.findByRole("link", { name: "Solicitar faltantes" });
    await waitFor(() =>
      expect(link).toHaveAttribute(
        "href",
        "/pedidos/nuevo?storeId=7&distributorId=9&faltantes=1,4",
      ),
    );
    expect(screen.getByRole("combobox")).toHaveValue("9");
    expect(storeLinksApi.fetchLinkedDistributorOptions).toHaveBeenCalledWith(7);
  });

  it("operador sin distribuidores vinculados: invita a vincular uno", async () => {
    vi.mocked(storeLinksApi.fetchLinkedDistributorOptions).mockResolvedValue({
      data: [],
      error: null,
    });
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({ data: [FILA], error: null });

    renderPage("operador");

    expect(await screen.findByRole("link", { name: "Vinculá uno" })).toHaveAttribute(
      "href",
      "/distributors",
    );
    expect(screen.queryByRole("link", { name: "Solicitar faltantes" })).not.toBeInTheDocument();
  });

  it("admin: sin selector de distribuidor — no tiene tienda propia", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({ data: [FILA], error: null });

    renderPage("admin");

    const section = (await screen.findByRole("heading", { name: "Tienda Centro" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(section).getByText("Café molido")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Solicitar faltantes" })).not.toBeInTheDocument();
    expect(storeLinksApi.fetchLinkedDistributorOptions).not.toHaveBeenCalled();
  });
});
