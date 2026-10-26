import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as productsApi from "../../products/api";
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
vi.mock("../../products/api", () => ({
  fetchShortageProducts: vi.fn(),
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
    data: [{ id: 10, name: "Arroz", brand: "Diana", quantity: 12 }],
    error: null,
  });
  vi.mocked(storeLinksApi.fetchLinkedDistributorOptions).mockResolvedValue({
    data: [{ id: 7, name: "Distribuidora Andes" }],
    error: null,
  });
  vi.mocked(storeLinksApi.fetchStoreDistributorProducts).mockResolvedValue({
    data: [
      { id: 10, name: "Arroz", brand: null, quantity: null, price: 4500 },
      { id: 11, name: "Aceite", brand: null, quantity: null, price: null },
    ],
    error: null,
  });
  vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({ data: [], error: null });
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
    // 0024: sin precio ya no bloquea la solicitud; el distribuidor la cotiza.
    expect(screen.getByRole("option", { name: "Aceite (sin precio)" })).toBeEnabled();
    expect(product).toHaveValue("");
  });

  it("operador: busca productos por marca y por cantidad en stock", async () => {
    vi.mocked(storeLinksApi.fetchStoreDistributorProducts).mockResolvedValue({
      data: [
        { id: 10, name: "Arroz", brand: "Diana", quantity: 12, price: 4500 },
        { id: 11, name: "Aceite", brand: "Premier", quantity: 0, price: 3000 },
      ],
      error: null,
    });
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    const search = await screen.findByLabelText("Buscar producto 1");
    await user.type(search, "premier");
    expect(screen.queryByRole("option", { name: /^Arroz/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /^Aceite/ })).toBeInTheDocument();

    await user.clear(search);
    await user.type(screen.getByLabelText("Cantidad mínima de producto 1"), "5");
    expect(screen.getByRole("option", { name: /^Arroz/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^Aceite/ })).not.toBeInTheDocument();
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

  // 0024: la solicitud nace sin precio y el distribuidor la cotiza después.
  it("operador: puede pedir un producto sin precio y no ve el aviso de bloqueo", async () => {
    vi.mocked(ordersApi.createOrder).mockResolvedValue({ data: 42, error: null });
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByLabelText("Producto 1"), "11");
    await user.type(screen.getByLabelText("Cantidad 1"), "3");
    expect(screen.queryByText(/no tiene precio en esta tienda/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Inventario/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Crear pedido" }));

    await waitFor(() =>
      expect(ordersApi.createOrder).toHaveBeenCalledWith({
        storeId: 3,
        distributorId: 7,
        items: [{ product_id: 11, quantity: 3 }],
        expectedAt: null,
        notes: null,
      }),
    );
  });

  it("operador con todos los productos sin precio: igual puede solicitar", async () => {
    vi.mocked(storeLinksApi.fetchStoreDistributorProducts).mockResolvedValue({
      data: [
        { id: 10, name: "Arroz", brand: null, quantity: null, price: null },
        { id: 11, name: "Aceite", brand: null, quantity: null, price: null },
      ],
      error: null,
    });
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");

    expect(await screen.findByRole("option", { name: "Arroz (sin precio)" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Aceite (sin precio)" })).toBeEnabled();
    expect(screen.queryByText(/no tienen precio en esta tienda/)).not.toBeInTheDocument();
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
    expect(await screen.findByRole("option", { name: /^Arroz/ })).toBeInTheDocument();
    expect(ordersApi.fetchDistributorOptions).toHaveBeenCalledTimes(1);
    expect(ordersApi.fetchStoreProducts).toHaveBeenCalledWith(3);
    expect(storeLinksApi.fetchStoreDistributorProducts).not.toHaveBeenCalled();
  });

  // S3: /faltantes llega con los productos elegidos; 0024 ya no descarta los
  // que no tienen precio: se precargan todos con cantidad 1 para ajustar.
  it("operador desde faltantes: precarga todos los productos del filtro", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7&faltantes=10,11");

    await waitFor(() => expect(screen.getByLabelText("Producto 1")).toHaveValue("10"));
    expect(screen.getByLabelText("Cantidad 1")).toHaveValue(1);
    expect(screen.getByLabelText("Producto 2")).toHaveValue("11");
    expect(
      screen.getByText(
        "Vienen preseleccionados los faltantes de la tienda: ajustá las cantidades.",
      ),
    ).toBeInTheDocument();
  });

  it("S9: muestra los faltantes de la tienda y los agrega rápido", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({
      data: [
        {
          store_id: 3,
          store_name: "Tienda Centro",
          product_id: 10,
          name: "Arroz",
          brand: "Diana",
          unit: "kg",
          category: "Granos",
          quantity: 0,
          base_quantity: 1,
        },
        {
          store_id: 3,
          store_name: "Tienda Centro",
          product_id: 11,
          name: "Aceite",
          brand: null,
          unit: "L",
          category: "Aceites",
          quantity: 0,
          base_quantity: 1,
        },
        {
          store_id: 4,
          store_name: "Tienda Norte",
          product_id: 10,
          name: "Arroz",
          brand: "Diana",
          unit: "kg",
          category: "Granos",
          quantity: 0,
          base_quantity: 1,
        },
      ],
      error: null,
    });
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    expect(
      await screen.findByRole("heading", { name: "Faltantes de la tienda" }),
    ).toBeInTheDocument();
    // Solo los faltantes de la tienda elegida (2, no 3).
    expect(screen.getAllByRole("button", { name: "Agregar" })).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: "Agregar" })[0]);
    expect(screen.getByLabelText("Producto 1")).toHaveValue("10");
    expect(screen.getAllByRole("button", { name: "Agregado" })[0]).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Agregar todos" }));
    expect(screen.getByLabelText("Producto 2")).toHaveValue("11");
  });

  it("S9: no ofrece agregar un faltante que el distribuidor no maneja", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({
      data: [
        {
          store_id: 3,
          store_name: "Tienda Centro",
          product_id: 99,
          name: "Detergente",
          brand: null,
          unit: "L",
          category: "Aseo",
          quantity: 0,
          base_quantity: 1,
        },
      ],
      error: null,
    });
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");

    expect(
      await screen.findByText("No está en el catálogo del distribuidor"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled();
  });

  it("S9: sin distribuidor elegido, los faltantes se ven pero no se pueden agregar", async () => {
    vi.mocked(productsApi.fetchShortageProducts).mockResolvedValue({
      data: [
        {
          store_id: 3,
          store_name: "Tienda Centro",
          product_id: 10,
          name: "Arroz",
          brand: "Diana",
          unit: "kg",
          category: "Granos",
          quantity: 0,
          base_quantity: 1,
        },
      ],
      error: null,
    });
    renderPage("operador", "/pedidos/nuevo?storeId=3");

    expect(
      await screen.findByText("Elegí un distribuidor para saber cuáles podés pedir."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agregar todos" })).toBeDisabled();
  });
});
