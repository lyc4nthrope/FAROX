import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as catalogsApi from "../api";
import { getCatalogDefinition } from "../definitions";
import type { CatalogKey, CatalogRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { CatalogCrudPage } from "./CatalogCrudPage";

// sdd/admin-console T-C4/T-C6 + T-B10 (ADM-9): suite PARAMETRIZADA ×4
// claves sobre el motor config-driven (D-M1) — el api de la feature se
// mockea COMPLETO y fetchPrivileges SIEMPRE por rol (patrón
// StoresPage.test.tsx:56-57); ningún test depende de un admin real (R4/B0).
vi.mock("../api", () => ({
  fetchCatalogRows: vi.fn(),
  createCatalogRow: vi.fn(),
  updateCatalogRow: vi.fn(),
  deactivateCatalogRow: vi.fn(),
  deleteCatalogRow: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const KEYS: CatalogKey[] = ["unit_types", "store_types", "brands", "product_categories"];

// Fila por key con SOLO sus columnas reales cargadas (select explícito, D4):
// el resto degrade a null y la tabla lo pinta como «—».
function filaBase(key: CatalogKey): CatalogRow {
  const comun: CatalogRow = {
    id: 1,
    name: "Kilogramo",
    is_active: true,
    abbreviation: null,
    category: null,
    description: null,
    parent_id: null,
    parent_name: null,
  };
  if (key === "unit_types") return { ...comun, name: "Kilogramo", abbreviation: "kg", category: "peso" };
  if (key === "store_types") return { ...comun, name: "Tienda" };
  if (key === "brands") return { ...comun, name: "Zarpa" };
  return { ...comun, name: "Refrescos", description: "Gaseosas" };
}

const NUEVO_NOMBRE: Record<CatalogKey, string> = {
  unit_types: "Galón",
  store_types: "Kiosco",
  brands: "Zarpa Nueva",
  product_categories: "Snacks",
};

// Campos extra del form por key (los que no son name).
const EXTRA: Record<CatalogKey, Record<string, string>> = {
  unit_types: { abbreviation: "gal", category: "volumen" },
  store_types: {},
  brands: {},
  product_categories: { description: "Del sur", parent_id: "" },
};

// Payload exacto que createCatalogRow debe recibir (viaja por toDbRow).
const PAYLOAD_ALTA: Record<CatalogKey, Record<string, unknown>> = {
  unit_types: { name: "Galón", abbreviation: "gal", category: "volumen" },
  store_types: { name: "Kiosco" },
  brands: { name: "Zarpa Nueva" },
  product_categories: { name: "Snacks", description: "Del sur", parent_id: null },
};

// Payload de edición: los valores salen de la FILA (abbreviation kg, peso…).
const PAYLOAD_EDICION: Record<CatalogKey, Record<string, unknown>> = {
  unit_types: { name: "Kilo", abbreviation: "kg", category: "peso" },
  store_types: { name: "Minimercado" },
  brands: { name: "Zarpa Roja" },
  product_categories: { name: "Refrescos Zero", description: "Gaseosas", parent_id: null },
};

// Literales con `code` en variable (excess-property check de TS, patrón
// StoresPage.test.tsx:49).
const ERROR_DUPLICADO = {
  code: "23505",
  message: "duplicate key value violates unique constraint (raw)",
};
const ERROR_EN_USO = {
  code: "23503",
  message: "update or delete violates foreign key constraint (raw)",
};

// _key: el mock del test no filtra por key (la resolución de definition ya
// la hace la página) — el parámetro documenta la llamada real.
function mockListado(_key: CatalogKey, rows: CatalogRow[]): void {
  vi.mocked(catalogsApi.fetchCatalogRows).mockResolvedValue({
    rows,
    count: rows.length,
    error: null,
  });
}

// El form es inline (siempre montado): en product_categories el picker
// «Categoría padre» lista los MISMOS nombres como <option>, así que toda
// query sobre el nombre de una fila se acota a la tabla (T-002).
function tabla(): Promise<HTMLElement> {
  return screen.findByRole("table");
}

// La celda de nombre es la PRIMERA de cada fila; el resto de celdas pueden
// repetir el mismo texto (p. ej. «Categoría padre» de un hijo apunta al
// padre), así que la fila se identifica por SU primera celda (T-002).
async function filaPorNombre(nombre: string): Promise<HTMLElement> {
  const tablaEl = await tabla();
  const filas = within(tablaEl).getAllByRole("row").slice(1); // sin el header
  const fila = filas.find(
    (f) => within(f).getAllByRole("cell")[0]?.textContent === nombre,
  );
  if (fila === undefined) {
    throw new Error(`No hay fila con nombre «${nombre}» en la tabla`);
  }
  return fila;
}

function renderPagina(key: CatalogKey | string, role: RoleName = "admin") {
  vi.mocked(authApi.getSession).mockResolvedValue({
    userId: "u1",
    email: "demo@farox.app",
  });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={[`/catalogs/${key}`]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/catalogs/:catalogKey"
            element={
              <RequireRole roles={["admin"]}>
                <CatalogCrudPage />
              </RequireRole>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Tipea el form COMPLETO de la key con el nombre nuevo + sus extras.
async function completarForm(
  key: CatalogKey,
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  const definition = getCatalogDefinition(key);
  expect(definition).toBeDefined();
  for (const field of definition!.fields) {
    const valor = field.key === "name" ? NUEVO_NOMBRE[key] : (EXTRA[key][field.key] ?? "");
    if (valor === "") continue;
    await user.type(screen.getByLabelText(field.label), valor);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(catalogsApi.createCatalogRow).mockResolvedValue({ error: null });
  vi.mocked(catalogsApi.updateCatalogRow).mockResolvedValue({ error: null });
  vi.mocked(catalogsApi.deactivateCatalogRow).mockResolvedValue({ error: null });
  vi.mocked(catalogsApi.deleteCatalogRow).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe.each(KEYS)("CatalogCrudPage · %s (ADM-9.1 CRUD + ADM-9.5 cero-request)", (key) => {
  beforeEach(() => {
    mockListado(key, [filaBase(key)]);
  });

  it("ADM-9.1: pinta la fila del listado con sus columnas", async () => {
    renderPagina(key);

    expect(await within(await tabla()).findByText(filaBase(key).name)).toBeInTheDocument();
    expect(catalogsApi.fetchCatalogRows).toHaveBeenCalledTimes(1);
  });

  it("ADM-9.1: crear ⇒ createCatalogRow con el payload de toDbRow y refetch que muestra la fila nueva", async () => {
    const user = userEvent.setup();
    const creada: CatalogRow = {
      ...filaBase(key),
      id: 2,
      name: NUEVO_NOMBRE[key],
    };
    vi.mocked(catalogsApi.fetchCatalogRows).mockResolvedValueOnce({
      rows: [filaBase(key)],
      count: 1,
      error: null,
    });
    mockListado(key, [filaBase(key), creada]);
    renderPagina(key);
    await within(await tabla()).findByText(filaBase(key).name);

    await completarForm(key, user);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(catalogsApi.createCatalogRow).toHaveBeenCalledTimes(1);
    expect(catalogsApi.createCatalogRow).toHaveBeenCalledWith(key, PAYLOAD_ALTA[key]);
    // HARD-3: refetch posterior — la tabla refleja el cambio (ADM-9.1).
    expect(await within(await tabla()).findByText(NUEVO_NOMBRE[key])).toBeInTheDocument();
    expect(catalogsApi.fetchCatalogRows).toHaveBeenCalledTimes(2);
  });

  it("ADM-9.5: nombre vacío ⇒ errores inline y CERO invocaciones del api", async () => {
    const user = userEvent.setup();
    renderPagina(key);
    await within(await tabla()).findByText(filaBase(key).name);

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(catalogsApi.createCatalogRow).not.toHaveBeenCalled();
    expect(catalogsApi.updateCatalogRow).not.toHaveBeenCalled();
    expect(catalogsApi.deleteCatalogRow).not.toHaveBeenCalled();
    expect(catalogsApi.deactivateCatalogRow).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true");
  });

  it("ADM-9.1: editar ⇒ el form se carga con la fila y updateCatalogRow recibe el payload", async () => {
    const user = userEvent.setup();
    renderPagina(key);
    await within(await tabla()).findByText(filaBase(key).name);

    await user.click(screen.getByRole("button", { name: "Editar" }));
    expect(await screen.findByLabelText("Nombre")).toHaveValue(filaBase(key).name);

    await user.clear(screen.getByLabelText("Nombre"));
    await user.type(screen.getByLabelText("Nombre"), PAYLOAD_EDICION[key].name as string);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(catalogsApi.updateCatalogRow).toHaveBeenCalledWith(key, 1, PAYLOAD_EDICION[key]);
    expect(catalogsApi.createCatalogRow).not.toHaveBeenCalled();
  });

  it("ADM-9.3: duplicado del server (23505) ⇒ mensaje amigable, jamás texto crudo", async () => {
    vi.mocked(catalogsApi.createCatalogRow).mockResolvedValue({ error: ERROR_DUPLICADO });
    const user = userEvent.setup();
    renderPagina(key);
    await within(await tabla()).findByText(filaBase(key).name);

    await completarForm(key, user);
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un registro con ese nombre.",
    );
    expect(screen.queryByText(/duplicate key/)).toBeNull();
  });

  it("ADM-9.4: en uso del server (23503) ⇒ «en uso» amigable y la fila permanece", async () => {
    // brands exige fila ya desactivada para ofrecer «Eliminar» (0006:95-97).
    const fila = key === "brands" ? { ...filaBase(key), is_active: false } : filaBase(key);
    mockListado(key, [fila]);
    vi.mocked(catalogsApi.deleteCatalogRow).mockResolvedValue({ error: ERROR_EN_USO });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPagina(key);
    await within(await tabla()).findByText(fila.name);

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este registro está en uso y no se puede eliminar.",
    );
    expect(screen.queryByText(/foreign key/)).toBeNull();
    // La fila permanece: el borrado fallido no refetchea ni tumba la tabla.
    expect(within(await tabla()).getByText(filaBase(key).name)).toBeInTheDocument();
    expect(catalogsApi.fetchCatalogRows).toHaveBeenCalledTimes(1);
  });
});

describe("CatalogCrudPage · deleteMode HARD (unit_types / store_types / product_categories)", () => {
  it.each(["unit_types", "store_types", "product_categories"] as CatalogKey[])(
    "%s: «Eliminar» visible en toda fila ⇒ deleteCatalogRow directo",
    async (key) => {
      mockListado(key, [filaBase(key)]);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const user = userEvent.setup();
      renderPagina(key);
      await within(await tabla()).findByText(filaBase(key).name);

      await user.click(screen.getByRole("button", { name: "Eliminar" }));

      expect(catalogsApi.deleteCatalogRow).toHaveBeenCalledWith(key, 1);
      // Nunca el two-step en tablas hard.
      expect(catalogsApi.deactivateCatalogRow).not.toHaveBeenCalled();
    },
  );
});

describe("CatalogCrudPage · brands soft-two-step (ADM-9.2 · policy 0006:95-97)", () => {
  beforeEach(() => {
    mockListado("brands", [filaBase("brands")]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("marca ACTIVA: ofrece «Desactivar» y NO ofrece «Eliminar»", async () => {
    renderPagina("brands");

    const fila = (await screen.findByText("Zarpa")).closest("tr") as HTMLElement;
    expect(within(fila).getByRole("button", { name: "Desactivar" })).toBeInTheDocument();
    expect(within(fila).queryByRole("button", { name: "Eliminar" })).toBeNull();
  });

  it("desactivar ⇒ deactivateCatalogRow, la fila SIGUE listada como «Inactiva» y recién ahí aparece «Eliminar»", async () => {
    const inactiva: CatalogRow = { ...filaBase("brands"), is_active: false };
    vi.mocked(catalogsApi.fetchCatalogRows).mockResolvedValueOnce({
      rows: [filaBase("brands")],
      count: 1,
      error: null,
    });
    mockListado("brands", [inactiva]);
    const user = userEvent.setup();
    renderPagina("brands");
    await screen.findByText("Zarpa");

    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    expect(catalogsApi.deactivateCatalogRow).toHaveBeenCalledTimes(1);
    expect(catalogsApi.deactivateCatalogRow).toHaveBeenCalledWith("brands", 1);
    // El borrado SOLO se ofrece sobre filas ya desactivadas (0006:95-97).
    const fila = (await screen.findByText("Inactivo")).closest("tr") as HTMLElement;
    expect(within(fila).getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(within(fila).queryByRole("button", { name: "Desactivar" })).toBeNull();
    expect(catalogsApi.deleteCatalogRow).not.toHaveBeenCalled();
  });

  it("marcas inactivas: «Eliminar» es el paso 2 ⇒ deleteCatalogRow sobre la fila ya desactivada", async () => {
    mockListado("brands", [{ ...filaBase("brands"), is_active: false }]);
    const user = userEvent.setup();
    renderPagina("brands");
    await screen.findByText("Zarpa");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(catalogsApi.deleteCatalogRow).toHaveBeenCalledWith("brands", 1);
    expect(catalogsApi.deactivateCatalogRow).not.toHaveBeenCalled();
  });

  it("el form de brands es SOLO nombre: is_active no es campo editable (muta solo por acción)", async () => {
    const user = userEvent.setup();
    renderPagina("brands");
    await screen.findByText("Zarpa");

    await user.click(screen.getByRole("button", { name: "Editar" }));

    expect(await screen.findByLabelText("Nombre")).toHaveValue("Zarpa");
    expect(screen.queryByLabelText(/activo/i)).toBeNull();
  });
});

describe("CatalogCrudPage · product_categories · padre e hijos (ADM-9.4)", () => {
  const BEBIDAS: CatalogRow = {
    id: 1,
    name: "Bebidas",
    is_active: true,
    abbreviation: null,
    category: null,
    description: "Bebidas en general",
    parent_id: null,
    parent_name: null,
  };
  const REFRESCOS: CatalogRow = {
    id: 2,
    name: "Refrescos",
    is_active: true,
    abbreviation: null,
    category: null,
    description: "Gaseosas",
    parent_id: 1,
    parent_name: "Bebidas",
  };

  it("el picker «categoría padre» ofrece las otras filas y EXCLUYE la que se edita (auto-parent imposible)", async () => {
    mockListado("product_categories", [BEBIDAS, REFRESCOS]);
    const user = userEvent.setup();
    renderPagina("product_categories");
    const filaRefrescos = await filaPorNombre("Refrescos");

    await user.click(within(filaRefrescos).getByRole("button", { name: "Editar" }));

    const picker = await screen.findByLabelText("Categoría padre");
    expect(picker).toHaveValue("1"); // el padre actual viaja cargado
    expect(screen.getByRole("option", { name: "Bebidas" })).toBeInTheDocument();
    // La fila en edición no se ofrece como padre de sí misma.
    expect(screen.queryByRole("option", { name: "Refrescos" })).toBeNull();
  });

  it("borrar el padre ⇒ tras refetch los hijos quedan sin categoría padre (SET NULL, 0002:64)", async () => {
    mockListado("product_categories", [BEBIDAS, REFRESCOS]);
    const hijosSinPadre: CatalogRow = { ...REFRESCOS, parent_id: null, parent_name: null };
    vi.mocked(catalogsApi.fetchCatalogRows).mockResolvedValueOnce({
      rows: [BEBIDAS, REFRESCOS],
      count: 2,
      error: null,
    });
    mockListado("product_categories", [hijosSinPadre]);
    const user = userEvent.setup();
    renderPagina("product_categories");
    const filaPadre = await filaPorNombre("Bebidas");

    await user.click(within(filaPadre).getByRole("button", { name: "Eliminar" }));

    expect(catalogsApi.deleteCatalogRow).toHaveBeenCalledWith("product_categories", 1);
    // El refetch pinta el hijo con la columna padre en «—» (null propagado).
    const filaHijo = await filaPorNombre("Refrescos");
    await waitFor(() => {
      expect(within(filaHijo).getByText("—")).toBeInTheDocument();
    });
  });
});

describe("CatalogCrudPage · clave inválida y denegación de rol", () => {
  it("clave inválida (/catalogs/no_existe) ⇒ <NotFound/> SIN invocar el api", async () => {
    renderPagina("no_existe");

    expect(await screen.findByText("Página no encontrada")).toBeInTheDocument();
    expect(catalogsApi.fetchCatalogRows).not.toHaveBeenCalled();
  });

  it("ADM-12.3/R4: operador denegado ⇒ AccessDenied sin UNA sola query de la feature", async () => {
    mockListado("brands", [filaBase("brands")]);
    renderPagina("brands", "operador");

    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(catalogsApi.fetchCatalogRows).not.toHaveBeenCalled();
  });
});
