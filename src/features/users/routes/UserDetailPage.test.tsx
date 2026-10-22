import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as usersApi from "../api";
import { userProfileSchema } from "../schemas";
import type { UserDetailRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { UserDetailPage } from "./UserDetailPage";

// sdd/admin-console T-B5..T-B8 + T-B10 (ADM-4..ADM-7): detalle /users/:id con
// el api de la feature mockeado COMPLETO y fetchPrivileges mockeado por rol
// (patrón StoresPage.test.tsx:56-57) — NINGÚN test depende de un admin real
// (R4/B0). Cero red real: los errores se inyectan con su forma canónica.
vi.mock("../api", () => ({
  fetchUsers: vi.fn(),
  fetchUser: vi.fn(),
  updateUserProfile: vi.fn(),
  updateUserRole: vi.fn(),
  setUserPremium: vi.fn(),
  setUserActive: vi.fn(),
  fetchUserStores: vi.fn(),
  fetchUserStoreCounts: vi.fn(),
  fetchDistributorOptions: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

// La sesión SIEMPRE es "u1" ⇒ los tests eligen si el objetivo es la propia
// fila (u1) o una ajena (u2) para cubrir las guards de auto-gestión (ADM-6.2).
const OTRO: UserDetailRow = {
  id: "u2",
  email: "omar@farox.app",
  full_name: "Omar Prueba",
  phone_number: "300 222 3333",
  contact_preference: "whatsapp",
  distributor_id: null,
  premium: false,
  is_active: true,
  role: { id: 2, name: "operador" },
};

const OTRO_DISTRIBUIDOR: UserDetailRow = {
  ...OTRO,
  distributor_id: 5,
  role: { id: 3, name: "distribuidor" },
};

const YO: UserDetailRow = {
  id: "u1",
  email: "ana@farox.app",
  full_name: "Ana Admin",
  phone_number: "555-0001",
  contact_preference: "email",
  distributor_id: null,
  premium: false,
  is_active: true,
  role: { id: 1, name: "admin" },
};

const ERROR_RLS = { code: "42501", message: "permission denied for table users" };
const SIN_FILA = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
};
// Mismo motivo que ERROR_RLS: literales con `code` en variable, porque el tipo
// del error del api es { message: string } y el excess-property check de TS
// rechazaría el literal fresco (patrón StoresPage.test.tsx:49).
const ERROR_ROL = { code: "P0001", message: "rol inexistente: superusuario" };
const ERROR_SOLO_ADMIN = { code: "P0001", message: "set_user_active: solo admin" };
const ERROR_SIN_GRANT = {
  code: "42501",
  message: "permission denied for table user_stores",
};

// El badge de rol del header compite textualmente con el <option> del select
// del panel — se aísla por TAG para probar el «badge se actualiza tras
// refetch» (ADM-5.1) sin ambigüedad.
async function seVeElBadge(nombre: string): Promise<void> {
  await waitFor(() => {
    const encontrados = screen.getAllByText(nombre);
    expect(encontrados.some((el) => el.tagName === "SPAN")).toBe(true);
  });
}

function renderPagina(role: RoleName = "admin", targetId = "u2") {
  vi.mocked(authApi.getSession).mockResolvedValue({
    userId: "u1",
    email: "demo@farox.app",
  });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={[`/users/${targetId}`]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/users/:id"
            element={
              <RequireRole roles={["admin"]}>
                <UserDetailPage />
              </RequireRole>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(usersApi.fetchUser).mockResolvedValue({ row: OTRO, error: null });
  vi.mocked(usersApi.fetchUserStores).mockResolvedValue({ rows: [], error: null });
  vi.mocked(usersApi.fetchDistributorOptions).mockResolvedValue({
    options: [{ id: 5, name: "Distribuidora Sur" }],
    error: null,
  });
  vi.mocked(usersApi.updateUserProfile).mockResolvedValue({ error: null });
  vi.mocked(usersApi.updateUserRole).mockResolvedValue({ error: null });
  vi.mocked(usersApi.setUserPremium).mockResolvedValue({ error: null });
  vi.mocked(usersApi.setUserActive).mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
});

describe("UserDetailPage · ADM-4 (perfil: SOLO las 3 columnas GRANT'd)", () => {
  it("ADM-4.1: guardar válido ⇒ updateUserProfile con exactamente 3 columnas + refetch de la fila", async () => {
    const user = userEvent.setup();
    renderPagina();

    // Form precargado desde fetchUser.
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Perfil actualizado.")).toBeInTheDocument();
    expect(usersApi.updateUserProfile).toHaveBeenCalledTimes(1);
    const [id, valores] = vi.mocked(usersApi.updateUserProfile).mock.calls[0];
    expect(id).toBe("u2");
    expect(valores).toEqual({
      full_name: "Omar Prueba",
      phone_number: "300 222 3333",
      contact_preference: "whatsapp",
    });
    // Exactamente esas 3 claves: cualquier columna extra rompe el toEqual…
    expect(Object.keys(valores)).toHaveLength(3);
    // …y acá además: ni role_id, ni email, ni premium, ni is_active.
    expect(valores).not.toHaveProperty("role_id");
    expect(valores).not.toHaveProperty("premium");
    // refetch de la fila tras el update (ADM-4.1).
    expect(usersApi.fetchUser).toHaveBeenCalledTimes(2);
  });

  it("ADM-4.2: nombre vacío ⇒ error inline y CERO requests (Zod ANTES de la red)", async () => {
    const user = userEvent.setup();
    renderPagina();
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Nombre completo"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Ingresá tu nombre")).toBeInTheDocument();
    expect(usersApi.updateUserProfile).not.toHaveBeenCalled();
    expect(usersApi.fetchUser).toHaveBeenCalledTimes(1); // solo la carga inicial

    // La rama del enum también está bloqueada por el MISMO schema: un valor
    // fuera de contact_preference hace fallar el parse ⇒ cero requests.
    expect(
      userProfileSchema.safeParse({
        full_name: "Omar Prueba",
        phone_number: "300 222 3333",
        contact_preference: "paloma mensajera",
      }).success,
    ).toBe(false);
  });

  it("ADM-4.3: 42501 del update ⇒ «No tenés permisos para esta operación.», jamás texto crudo", async () => {
    vi.mocked(usersApi.updateUserProfile).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderPagina();
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).toBeNull();
    expect(screen.queryByText("Perfil actualizado.")).toBeNull();
  });
});

describe("UserDetailPage · ADM-5 (rol SOLO vía update_user_role)", () => {
  it("ADM-5.1: cambiar a «operador» ⇒ rpc con p_distributor NULL y badge actualizado tras refetch", async () => {
    const COMO_OPERADOR: UserDetailRow = {
      ...OTRO_DISTRIBUIDOR,
      distributor_id: null,
      role: { id: 2, name: "operador" },
    };
    vi.mocked(usersApi.fetchUser)
      .mockResolvedValueOnce({ row: OTRO_DISTRIBUIDOR, error: null })
      .mockResolvedValue({ row: COMO_OPERADOR, error: null });
    const user = userEvent.setup();
    renderPagina();

    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Rol"), "operador");
    await user.click(screen.getByRole("button", { name: "Guardar rol" }));

    expect(await screen.findByText("Rol actualizado.")).toBeInTheDocument();
    expect(usersApi.updateUserRole).toHaveBeenCalledWith("u2", "operador", null);
    // Refetch: el badge de la cabecera pasa de «Distribuidor» a «Operador».
    expect(usersApi.fetchUser).toHaveBeenCalledTimes(2);
    await seVeElBadge("Operador");
  });

  it("ADM-5.2: «distribuidor» SIN distribuidor ⇒ Zod bloquea, CERO rpc y copy M11 visible", async () => {
    const user = userEvent.setup();
    renderPagina();
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Rol"), "distribuidor");
    await user.click(screen.getByRole("button", { name: "Guardar rol" }));

    expect(
      await screen.findByText("El rol distribuidor requiere elegir un distribuidor."),
    ).toBeInTheDocument();
    expect(usersApi.updateUserRole).not.toHaveBeenCalled();
    expect(usersApi.fetchUser).toHaveBeenCalledTimes(1); // solo la carga inicial
  });

  it("ADM-5.3: «distribuidor» + distribuidor elegido ⇒ rpc con p_distributor y la fila queda con el alcance", async () => {
    const CON_DISTRIBUIDOR: UserDetailRow = {
      ...OTRO,
      distributor_id: 5,
      role: { id: 3, name: "distribuidor" },
    };
    vi.mocked(usersApi.fetchUser)
      .mockResolvedValueOnce({ row: OTRO, error: null })
      .mockResolvedValue({ row: CON_DISTRIBUIDOR, error: null });
    const user = userEvent.setup();
    renderPagina();
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Rol"), "distribuidor");
    await user.selectOptions(screen.getByLabelText("Distribuidor"), "5");
    await user.click(screen.getByRole("button", { name: "Guardar rol" }));

    expect(await screen.findByText("Rol actualizado.")).toBeInTheDocument();
    expect(usersApi.updateUserRole).toHaveBeenCalledWith("u2", "distribuidor", 5);
    expect(usersApi.fetchUser).toHaveBeenCalledTimes(2);
    // El distributor_id de la fila queda visible en la cabecera (refetch).
    expect(await screen.findByText("Distribuidor: Distribuidora Sur")).toBeInTheDocument();
  });

  it("ADM-5.4: la rpc rechaza con «rol inexistente» ⇒ «El rol seleccionado no existe.»", async () => {
    vi.mocked(usersApi.updateUserRole).mockResolvedValue({ error: ERROR_ROL });
    const user = userEvent.setup();
    renderPagina();
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar rol" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El rol seleccionado no existe.",
    );
    expect(screen.queryByText(/rol inexistente/)).toBeNull();
  });
});

describe("UserDetailPage · ADM-6 (toggles premium y activo + guarda propia)", () => {
  it("ADM-6.1: premium ⇒ set_user_premium(true) y el estado refresca tras refetch (sin optimistic)", async () => {
    const user = userEvent.setup();
    renderPagina();
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();

    const premium = screen.getByRole("switch", { name: "Premium" });
    expect(premium).not.toBeChecked();
    vi.mocked(usersApi.fetchUser).mockResolvedValue({
      row: { ...OTRO, premium: true },
      error: null,
    });
    await user.click(premium);

    expect(usersApi.setUserPremium).toHaveBeenCalledWith("u2", true);
    expect(await screen.findByText("Ahora es premium.")).toBeInTheDocument();
    expect(usersApi.fetchUser).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Premium" })).toBeChecked(),
    );
  });

  it("ADM-6.2: en la fila PROPIA el toggle de activo está deshabilitado con copy voseo y CERO requests", async () => {
    vi.mocked(usersApi.fetchUser).mockResolvedValue({ row: YO, error: null });
    const user = userEvent.setup();
    renderPagina("admin", "u1");

    const activo = await screen.findByRole("switch", { name: "Activo" });
    expect(activo).toBeDisabled();
    expect(
      await screen.findByText("No te podés desactivar a vos mismo."),
    ).toBeInTheDocument();

    await user.click(activo);

    expect(usersApi.setUserActive).not.toHaveBeenCalled();
    expect(usersApi.fetchUser).toHaveBeenCalledTimes(1); // solo la carga inicial
    // Premium propio sí está habilitado (ADM-6: sin extra).
    expect(screen.getByRole("switch", { name: "Premium" })).toBeEnabled();
  });

  it("ADM-6.3: desactivar a OTRO ⇒ set_user_active(false) y la fila queda visible e inactiva", async () => {
    const user = userEvent.setup();
    renderPagina();
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();
    vi.mocked(usersApi.fetchUser).mockResolvedValue({
      row: { ...OTRO, is_active: false },
      error: null,
    });

    await user.click(screen.getByRole("switch", { name: "Activo" }));

    expect(usersApi.setUserActive).toHaveBeenCalledWith("u2", false);
    expect(await screen.findByText("Usuario desactivado.")).toBeInTheDocument();
    // Fila visible con su estado nuevo (la página NO navega ni se borra).
    expect(screen.getByRole("heading", { name: "Omar Prueba" })).toBeInTheDocument();
    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Activo" })).not.toBeChecked(),
    );
  });

  it("ADM-6.4: admin degradado (rpc «solo admin») ⇒ «Solo un administrador puede hacer esto.»", async () => {
    vi.mocked(usersApi.setUserActive).mockResolvedValue({
      error: ERROR_SOLO_ADMIN,
    });
    const user = userEvent.setup();
    renderPagina();
    expect(await screen.findByDisplayValue("Omar Prueba")).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Activo" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Solo un administrador puede hacer esto.",
    );
    expect(screen.queryByText(/solo admin/)).toBeNull();
  });
});

describe("UserDetailPage · ADM-7 (tiendas asignadas en SOLO LECTURA)", () => {
  it("ADM-7.1: usuario con 2 tiendas ⇒ se ven ambas por nombre (embed stores)", async () => {
    vi.mocked(usersApi.fetchUserStores).mockResolvedValue({
      rows: [
        {
          store_id: 1,
          created_at: "2026-10-20T00:00:00+00:00",
          store_name: "Tienda Centro",
          store_city: "Bogotá",
        },
        {
          store_id: 2,
          created_at: "2026-10-20T00:00:01+00:00",
          store_name: "Tienda Norte",
          store_city: null,
        },
      ],
      error: null,
    });
    renderPagina();

    expect(await screen.findByText("Tienda Centro")).toBeInTheDocument();
    expect(screen.getByText("Tienda Norte")).toBeInTheDocument();
    // El panel leyó user_stores FILTRADO por el usuario del detalle…
    expect(usersApi.fetchUserStores).toHaveBeenCalledWith("u2");
  });

  it("ADM-7.2: sin filas en user_stores ⇒ «Sin tiendas asignadas», sin error", async () => {
    renderPagina();

    expect(await screen.findByText("Sin tiendas asignadas")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/permission denied/)).toBeNull();
  });

  it("ADM-7.3: el panel de tiendas NO contiene picker ni botón de asignación", async () => {
    renderPagina();
    const encabezado = await screen.findByRole("heading", {
      name: "Tiendas asignadas",
    });
    const seccion = encabezado.closest("section");
    expect(seccion).not.toBeNull();
    const scope = within(seccion as HTMLElement);

    expect(scope.queryByRole("button")).toBeNull();
    expect(scope.queryByRole("combobox")).toBeNull();
    expect(scope.queryByRole("switch")).toBeNull();
    expect(scope.queryByText(/asignar/i)).toBeNull();
  });

  it("I4/T-B10: sin el GRANT D2a (42501 en user_stores) ⇒ ErrorBanner amigable y la página sigue viva", async () => {
    vi.mocked(usersApi.fetchUserStores).mockResolvedValue({
      rows: [],
      error: ERROR_SIN_GRANT,
    });
    renderPagina();

    // La página carga igual: cabecera, perfil y rol no dependen de D2a.
    expect(await screen.findByRole("heading", { name: "Omar Prueba" })).toBeInTheDocument();
    const encabezado = await screen.findByRole("heading", {
      name: "Tiendas asignadas",
    });
    const scope = within(encabezado.closest("section") as HTMLElement);
    expect(await scope.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(scope.queryByText(/permission denied/)).toBeNull();
    expect(screen.queryByText("Sin tiendas asignadas")).toBeNull();
  });
});

describe("UserDetailPage · T-B10 (degradación elegante R4/B0 — sin admin real)", () => {
  it("error de red al cargar ⇒ mensaje amigable, la pantalla nunca crashea", async () => {
    vi.mocked(usersApi.fetchUser).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    renderPagina();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar, revisá tu conexión.",
    );
    expect(screen.queryByText(/failed to fetch/i)).toBeNull();
  });

  it("sin fila en la DB (B0 / id inexistente) ⇒ «No se encontró el registro.», sin texto crudo", async () => {
    vi.mocked(usersApi.fetchUser).mockResolvedValue({ row: null, error: SIN_FILA });
    renderPagina();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se encontró el registro.",
    );
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("UserDetailPage · T-E3 (cross-links a entidades existentes)", () => {
  it("cada tienda asignada linkea a /stores/:id", async () => {
    vi.mocked(usersApi.fetchUserStores).mockResolvedValue({
      rows: [
        {
          store_id: 1,
          created_at: "2026-10-20T00:00:00+00:00",
          store_name: "Tienda Centro",
          store_city: "Bogotá",
        },
        {
          store_id: 2,
          created_at: "2026-10-20T00:00:01+00:00",
          store_name: "Tienda Norte",
          store_city: null,
        },
      ],
      error: null,
    });
    renderPagina();

    const centro = await screen.findByRole("link", { name: "Tienda Centro" });
    expect(centro).toHaveAttribute("href", "/stores/1");
    expect(
      screen.getByRole("link", { name: "Tienda Norte" }),
    ).toHaveAttribute("href", "/stores/2");
  });

  it("sin tiendas asignadas ⇒ EmptyState y CERO links a /stores", async () => {
    renderPagina();

    expect(await screen.findByText("Sin tiendas asignadas")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Tienda/ })).toBeNull();
  });

  it("el distribuidor del usuario linkea a /distributors/:id", async () => {
    vi.mocked(usersApi.fetchUser).mockResolvedValue({
      row: OTRO_DISTRIBUIDOR,
      error: null,
    });
    renderPagina();

    const link = await screen.findByRole("link", {
      name: "Distribuidor: Distribuidora Sur",
    });
    expect(link).toHaveAttribute("href", "/distributors/5");
  });

  it("usuario SIN distribuidor ⇒ sin link al distribuidor", async () => {
    renderPagina();

    expect(await screen.findByRole("heading", { name: "Omar Prueba" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Distribuidor/ })).toBeNull();
  });
});
