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

/** Un solo buscador: escribe el término y agrega el resultado por su nombre. */
async function addProduct(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const search = await screen.findByLabelText("Buscar producto");
  await user.clear(search);
  await user.type(search, name);
  await user.click(await screen.findByRole("button", { name: `Agregar ${name}` }));
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
  it("operador: un solo buscador con la intersección y el precio informativo", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    expect(await screen.findByLabelText("Tienda")).toHaveValue("3");
    expect(await screen.findByLabelText("Distribuidor")).toHaveValue("7");
    await waitFor(() =>
      expect(storeLinksApi.fetchLinkedDistributorOptions).toHaveBeenCalledWith(3),
    );
    expect(storeLinksApi.fetchStoreDistributorProducts).toHaveBeenCalledWith(3, 7);
    expect(ordersApi.fetchDistributorOptions).not.toHaveBeenCalled();
    expect(ordersApi.fetchStoreProducts).not.toHaveBeenCalled();

    const search = screen.getByLabelText("Buscar producto");
    await user.type(search, "arroz");
    expect(await screen.findByText("Arroz")).toBeInTheDocument();
    expect(screen.getByText(/4\.500/)).toBeInTheDocument();
    expect(screen.queryByText("Aceite")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "aceite");
    expect(await screen.findByText("Aceite")).toBeInTheDocument();
    expect(screen.getByText(/sin precio/)).toBeInTheDocument();
    // 0024: sin precio ya no bloquea la solicitud; el distribuidor la cotiza.
    expect(screen.getByRole("button", { name: "Agregar Aceite" })).toBeEnabled();
  });

  it("busca por marca y el stock mínimo es un filtro que se muestra solo al abrirlo", async () => {
    vi.mocked(storeLinksApi.fetchStoreDistributorProducts).mockResolvedValue({
      data: [
        { id: 10, name: "Arroz", brand: "Diana", quantity: 12, price: 4500 },
        { id: 11, name: "Aceite", brand: "Premier", quantity: 0, price: 3000 },
      ],
      error: null,
    });
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    const search = await screen.findByLabelText("Buscar producto");
    await user.type(search, "premier");
    expect(await screen.findByText("Aceite")).toBeInTheDocument();
    expect(screen.queryByText("Arroz")).not.toBeInTheDocument();

    // El campo de stock mínimo NO aparece por defecto.
    expect(screen.queryByLabelText("Stock mínimo")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Filtros" }));
    expect(screen.getByLabelText("Stock mínimo")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "a");
    await user.type(screen.getByLabelText("Stock mínimo"), "5");
    expect(await screen.findByText("Arroz")).toBeInTheDocument();
    expect(screen.queryByText("Aceite")).not.toBeInTheDocument();
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
  it("operador: puede pedir un producto sin precio y la cantidad usa − / +", async () => {
    vi.mocked(ordersApi.createOrder).mockResolvedValue({ data: 42, error: null });
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    await addProduct(user, "Aceite");
    const quantity = screen.getByLabelText("Cantidad de Aceite");
    expect(quantity).toHaveValue(1);
    expect(screen.queryByText(/no tiene precio en esta tienda/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Inventario/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sumar cantidad de Aceite" }));
    await user.click(screen.getByRole("button", { name: "Sumar cantidad de Aceite" }));
    expect(quantity).toHaveValue(3);

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

  it("un solo buscador: los productos se acumulan abajo y no se duplican", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    await addProduct(user, "Arroz");
    await addProduct(user, "Aceite");

    expect(screen.getAllByLabelText("Buscar producto")).toHaveLength(1);
    expect(screen.getByLabelText("Cantidad de Arroz")).toHaveValue(1);
    expect(screen.getByLabelText("Cantidad de Aceite")).toHaveValue(1);
    // El buscador quedó vacío tras agregar: no hay resultados abiertos.
    expect(screen.getByLabelText("Buscar producto")).toHaveValue("");

    // El restar nunca baja de 1.
    expect(screen.getByRole("button", { name: "Restar cantidad de Arroz" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Sumar cantidad de Arroz" }));
    expect(screen.getByLabelText("Cantidad de Arroz")).toHaveValue(2);
    await user.click(screen.getByRole("button", { name: "Restar cantidad de Arroz" }));
    expect(screen.getByLabelText("Cantidad de Arroz")).toHaveValue(1);

    // Buscar el mismo producto otra vez no crea una segunda línea.
    const search = screen.getByLabelText("Buscar producto");
    await user.type(search, "arroz");
    expect(await screen.findByRole("button", { name: "Agregar Arroz" })).toBeDisabled();
    expect(screen.getAllByLabelText("Cantidad de Arroz")).toHaveLength(1);
  });

  it("la fila del resultado también agrega el producto", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Buscar producto"), "arroz");
    await user.click(await screen.findByText("Arroz"));

    expect(screen.getByLabelText("Cantidad de Arroz")).toHaveValue(1);
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
    const user = userEvent.setup();

    const search = await screen.findByLabelText("Buscar producto");
    await user.type(search, "arroz");
    expect(await screen.findByRole("button", { name: "Agregar Arroz" })).toBeEnabled();
    expect(screen.queryByText(/no tienen precio en esta tienda/)).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "aceite");
    expect(await screen.findByRole("button", { name: "Agregar Aceite" })).toBeEnabled();
  });

  it("cambiar de tienda limpia distribuidor y productos solicitados", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7");
    const user = userEvent.setup();

    expect(await screen.findByLabelText("Distribuidor")).toHaveValue("7");
    await addProduct(user, "Arroz");
    await user.selectOptions(screen.getByLabelText("Tienda"), "4");

    expect(screen.getByLabelText("Distribuidor")).toHaveValue("");
    expect(screen.queryByLabelText("Cantidad de Arroz")).not.toBeInTheDocument();
    expect(
      screen.getByText("Buscá un producto arriba o agregá un faltante para empezar la solicitud."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(storeLinksApi.fetchLinkedDistributorOptions).toHaveBeenCalledWith(4),
    );
  });

  it("admin: conserva distribuidores globales y productos de la tienda", async () => {
    renderPage("admin", "/pedidos/nuevo?storeId=3");
    const user = userEvent.setup();

    expect(await screen.findByRole("option", { name: "Distribuidora Global" })).toBeInTheDocument();
    await addProduct(user, "Arroz");
    expect(screen.getByLabelText("Cantidad de Arroz")).toBeInTheDocument();
    expect(ordersApi.fetchDistributorOptions).toHaveBeenCalledTimes(1);
    expect(ordersApi.fetchStoreProducts).toHaveBeenCalledWith(3);
    expect(storeLinksApi.fetchStoreDistributorProducts).not.toHaveBeenCalled();
  });

  // S3: /faltantes llega con los productos elegidos; 0024 ya no descarta los
  // que no tienen precio: se precargan todos con cantidad 1 para ajustar.
  it("operador desde faltantes: precarga todos los productos del filtro", async () => {
    renderPage("operador", "/pedidos/nuevo?storeId=3&distributorId=7&faltantes=10,11");

    await waitFor(() => expect(screen.getByLabelText("Cantidad de Arroz")).toHaveValue(1));
    expect(screen.getByLabelText("Cantidad de Aceite")).toHaveValue(1);
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
    expect(screen.getAllByRole("button", { name: /^Agregar faltante / })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Agregar faltante Arroz" }));
    expect(screen.getByLabelText("Cantidad de Arroz")).toHaveValue(1);
    expect(screen.getByRole("button", { name: "Agregar faltante Arroz" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Agregar todos" }));
    await user.click(screen.getByRole("button", { name: "Agregar todos" }));
    expect(screen.getByLabelText("Cantidad de Aceite")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^Cantidad de /)).toHaveLength(2);
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

    expect(await screen.findByText("No está en el catálogo del distribuidor")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agregar faltante Detergente" })).toBeDisabled();
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
    expect(screen.getByRole("button", { name: "Agregar faltante Arroz" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Agregar todos" })).toBeDisabled();
  });
});
