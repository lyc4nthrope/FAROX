import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as storeLinksApi from "../../store-links/api";
import * as ordersApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { NewOrderPage } from "./NewOrderPage";

vi.mock("../api", () => ({
  fetchStoreOptions: vi.fn(),
  fetchDistributorOptions: vi.fn(),
  fetchStoreProducts: vi.fn(),
  createOrder: vi.fn(),
}));
vi.mock("../../store-links/api", () => ({
  fetchLinkedDistributorOptions: vi.fn(),
  fetchStoreDistributorProducts: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function renderPage(role: RoleName, path = "/pedidos/nuevo") {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/pedidos/nuevo" element={<NewOrderPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(ordersApi.fetchStoreOptions).mockResolvedValue({
    data: [
      { id: 3, name: "Tienda Centro" },
      { id: 4, name: "Tienda Norte" },
    ],
    error: null,
  });
  vi.mocked(ordersApi.fetchDistributorOptions).mockResolvedValue({
    data: [{ id: 9, name: "Distribuidora Global" }],
    error: null,
  });
  vi.mocked(ordersApi.fetchStoreProducts).mockResolvedValue({
    data: [{ id: 10, name: "Arroz" }],
    error: null,
  });
  vi.mocked(storeLinksApi.fetchLinkedDistributorOptions).mockResolvedValue({
    data: [{ id: 7, name: "Distribuidora Andes" }],
    error: null,
  });
  vi.mocked(storeLinksApi.fetchStoreDistributorProducts).mockResolvedValue({
    data: [
      { id: 10, name: "Arroz", price: 4500 },
      { id: 11, name: "Aceite", price: null },
    ],
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe("NewOrderPage · solicitudes entre tienda y distribuidor vinculado", () => {
  it("operador: solo distribuidores vinculados y productos de la intersección con precio", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");

    expect(await screen.findByLabelText("Tienda")).toHaveValue("3");
    expect(await screen.findByLabelText("Distribuidor")).toHaveValue("7");
    await waitFor(() =>
      expect(storeLinksApi.fetchLinkedDistributorOptions).toHaveBeenCalledWith(3),
    );
    expect(storeLinksApi.fetchStoreDistributorProducts).toHaveBeenCalledWith(3, 7);
    expect(ordersApi.fetchDistributorOptions).not.toHaveBeenCalled();
    expect(ordersApi.fetchStoreProducts).not.toHaveBeenCalled();

    const product = screen.getByLabelText("Producto 1");
    const arroz = await screen.findByRole("option", { name: /^Arroz/ });
    expect(arroz).toHaveTextContent("4.500");
    expect(screen.getByRole("option", { name: "Aceite (sin precio)" })).toBeDisabled();
    expect(product).toHaveValue("");
  });

  it("operador sin vínculos: explica que debe vincular un distribuidor", async () => {
    vi.mocked(storeLinksApi.fetchLinkedDistributorOptions).mockResolvedValue({
      data: [],
      error: null,
    });
    renderPage("operador", "/pedidos/nuevo?storeId=3");

    expect(
      await screen.findByText(
        "Esta tienda no tiene distribuidores vinculados. Vinculá uno desde “Distribuidores”.",
      ),
    ).toBeInTheDocument();
  });

  it("cambiar de tienda limpia distribuidor, líneas y vuelve a consultar", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    expect(await screen.findByLabelText("Distribuidor")).toHaveValue("7");
    await user.selectOptions(await screen.findByLabelText("Producto 1"), "10");
    await user.type(screen.getByLabelText("Cantidad 1"), "2");
    await user.selectOptions(screen.getByLabelText("Tienda"), "4");

    expect(screen.getByLabelText("Distribuidor")).toHaveValue("");
    expect(screen.getByLabelText("Producto 1")).toHaveValue("");
    expect(screen.getByLabelText("Cantidad 1")).toHaveValue(null);
    await waitFor(() =>
      expect(storeLinksApi.fetchLinkedDistributorOptions).toHaveBeenCalledWith(4),
    );
  });

  it("admin: conserva distribuidores globales y productos de la tienda", async () => {
    renderPage("admin", "/pedidos/nuevo?storeId=3");

    expect(await screen.findByRole("option", { name: "Distribuidora Global" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Arroz" })).toBeInTheDocument();
    expect(ordersApi.fetchDistributorOptions).toHaveBeenCalledTimes(1);
    expect(ordersApi.fetchStoreProducts).toHaveBeenCalledWith(3);
    expect(storeLinksApi.fetchStoreDistributorProducts).not.toHaveBeenCalled();
  });

  // S3: /faltantes llega con los productos elegidos; solo se precargan los
  // pedibles (con precio) y con cantidad 1 para ajustar.
  it("operador desde faltantes: precarga los productos pedibles y descarta los que no tienen precio", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7&faltantes=10,11");

    await waitFor(() => expect(screen.getByLabelText("Producto 1")).toHaveValue("10"));
    expect(screen.getByLabelText("Cantidad 1")).toHaveValue(1);
    expect(
      screen.getByText("Vienen preseleccionados los faltantes de la tienda: ajustá las cantidades."),
    ).toBeInTheDocument();
    // El 11 venía en la lista pero no tiene precio activo: no se precarga.
    expect(screen.queryByLabelText("Producto 2")).not.toBeInTheDocument();
  });
});
