import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as rolesApi from "../api";
import type { RoleDetailRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireRole } from "../../../app/guards/RequireRole";
import { RoleFormPage } from "./RoleFormPage";

// sdd/admin-console T-C3 + T-B10 (ADM-8.1/8.2/8.4/8.5): form de rol con el
// api de la feature mockeado COMPLETO y fetchPrivileges mockeado por rol —
// NINGÚN test depende de un admin real (R4/B0). Cero red real.
vi.mock("../api", () => ({
  fetchRoles: vi.fn(),
  fetchRole: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn(),
  deleteRole: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const ADMIN_SEED: RoleDetailRow = {
  id: 1,
  name: "admin",
  description: "Acceso total: catálogos, usuarios, override de edición",
};
const LEGACY: RoleDetailRow = {
  id: 4,
  name: "supervisor",
  description: "Rol viejo de otra época",
};

// Literales con `code` en variable: el excess-property check de TS rechazaría
// el literal fresco (patrón StoresPage.test.tsx:49).
const ERROR_FK_EN_USO = {
  code: "23503",
  message: "delete on table roles violates foreign key constraint (raw)",
};
const ERROR_DUPLICADO = {
  code: "23505",
  message: "duplicate key value violates unique constraint (raw)",
};

// El harness replica las rutas DEL ROUTER REAL: /roles/new y /roles/:id
// exigen admin (ADM-12.3 se prueba en router.test). «/roles» resolve un stub
// para asertar la navegación tras un éxito.
function renderPagina(ruta: string, role: RoleName = "admin") {
  vi.mocked(authApi.getSession).mockResolvedValue({
    userId: "u1",
    email: "demo@farox.app",
  });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AuthProvider>
        <Routes>
          <Route
            path="/roles/new"
            element={
              <RequireRole roles={["admin"]}>
                <RoleFormPage />
              </RequireRole>
            }
          />
          <Route
            path="/roles/:id"
            element={
              <RequireRole roles={["admin"]}>
                <RoleFormPage />
              </RequireRole>
            }
          />
          <Route path="/roles" element={<p>Lista de roles</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
  vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  vi.mocked(rolesApi.createRole).mockResolvedValue({ error: null });
  vi.mocked(rolesApi.updateRole).mockResolvedValue({ error: null });
  vi.mocked(rolesApi.deleteRole).mockResolvedValue({ error: null });
  vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: null, error: null });
});

afterEach(() => {
  cleanup();
});

describe("RoleFormPage · alta /roles/new (ADM-8.1/8.2 · mitigación R3)", () => {
  it("ADM-8.1: nombre ∈ ROLE_NAMES ⇒ createRole con los valores exactos y navega a la lista", async () => {
    const user = userEvent.setup();
    renderPagina("/roles/new");

    await screen.findByLabelText("Nombre del rol");
    await user.type(screen.getByLabelText("Nombre del rol"), "operador");
    await user.type(screen.getByLabelText("Descripción"), "Otra vez");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(rolesApi.createRole).toHaveBeenCalledTimes(1);
    expect(rolesApi.createRole).toHaveBeenCalledWith({
      name: "operador",
      description: "Otra vez",
    });
    expect(await screen.findByText("Lista de roles")).toBeInTheDocument();
  });

  it("ADM-8.2: «superuser» ⇒ Zod bloquea, CERO requests y copy R3 visible", async () => {
    const user = userEvent.setup();
    renderPagina("/roles/new");

    await screen.findByLabelText("Nombre del rol");
    // El copy de la guarda está visible ANTES de fallar (hint del campo).
    expect(
      screen.getByText(/Para crear un rol nuevo hay que actualizar el catálogo de la app primero/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre del rol"), "superuser");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    // CERO invocaciones del api (Zod ANTES de la red — convención global).
    expect(rolesApi.createRole).not.toHaveBeenCalled();
    expect(rolesApi.updateRole).not.toHaveBeenCalled();
    expect(rolesApi.deleteRole).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Elegí un nombre de rol del catálogo de la app/),
    ).toBeInTheDocument();
  });

  it("nombre vacío ⇒ error inline y CERO requests (zero-request convención)", async () => {
    const user = userEvent.setup();
    renderPagina("/roles/new");

    await screen.findByLabelText("Nombre del rol");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(rolesApi.createRole).not.toHaveBeenCalled();
    expect(rolesApi.updateRole).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Elegí un nombre de rol del catálogo de la app/),
    ).toBeInTheDocument();
  });

  it("23505 del server (nombre ya existente) ⇒ mensaje amigable, jamás texto crudo", async () => {
    vi.mocked(rolesApi.createRole).mockResolvedValue({ error: ERROR_DUPLICADO });
    const user = userEvent.setup();
    renderPagina("/roles/new");

    await screen.findByLabelText("Nombre del rol");
    await user.type(screen.getByLabelText("Nombre del rol"), "operador");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya existe un registro con ese nombre.",
    );
    expect(screen.queryByText(/duplicate key/)).toBeNull();
  });
});

describe("RoleFormPage · edición /roles/:id (ADM-8.4/8.5)", () => {
  it("ADM-8.5: rol semilla ⇒ name deshabilitado, copy de protección y SIN botón de borrar", async () => {
    vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: ADMIN_SEED, error: null });
    renderPagina("/roles/1");

    const input = await screen.findByLabelText("Nombre del rol");
    expect(input).toBeDisabled();
    expect(input).toHaveValue("admin");
    expect(
      screen.getByText("Los roles del catálogo de la app no se pueden renombrar."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar rol" })).toBeNull();
  });

  it("rol semilla: descripción editable ⇒ updateRole conserva el name original", async () => {
    vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: ADMIN_SEED, error: null });
    const user = userEvent.setup();
    renderPagina("/roles/1");

    await screen.findByLabelText("Nombre del rol");
    await user.clear(screen.getByLabelText("Descripción"));
    await user.type(screen.getByLabelText("Descripción"), "Descripción nueva");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(rolesApi.updateRole).toHaveBeenCalledWith(1, {
      name: "admin",
      description: "Descripción nueva",
    });
    expect(await screen.findByText("Lista de roles")).toBeInTheDocument();
  });

  it("rol legacy: en edición el nombre queda bloqueado (C0.4) y se puede borrar", async () => {
    vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: LEGACY, error: null });
    renderPagina("/roles/4");

    const input = await screen.findByLabelText("Nombre del rol");
    expect(input).toBeDisabled();
    expect(input).toHaveValue("supervisor");
    expect(
      screen.getByRole("button", { name: "Eliminar rol" }),
    ).toBeInTheDocument();
  });

  it("ADM-8.4: borrar rol en uso (23503) ⇒ mensaje amigable y el formulario permanece", async () => {
    vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: LEGACY, error: null });
    vi.mocked(rolesApi.deleteRole).mockResolvedValue({ error: ERROR_FK_EN_USO });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPagina("/roles/4");

    await screen.findByLabelText("Nombre del rol");
    await user.click(screen.getByRole("button", { name: "Eliminar rol" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este registro está en uso y no se puede eliminar.",
    );
    // El formulario permanece: la fila NO desaparece (ADM-8.4).
    expect(screen.getByLabelText("Nombre del rol")).toBeInTheDocument();
    expect(screen.queryByText("Lista de roles")).toBeNull();
    expect(screen.queryByText(/violates foreign key/)).toBeNull();
  });

  it("borrar rol legacy sin uso ⇒ deleteRole y navega a la lista", async () => {
    vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: LEGACY, error: null });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderPagina("/roles/4");

    await screen.findByLabelText("Nombre del rol");
    await user.click(screen.getByRole("button", { name: "Eliminar rol" }));

    expect(rolesApi.deleteRole).toHaveBeenCalledTimes(1);
    expect(rolesApi.deleteRole).toHaveBeenCalledWith(4);
    expect(await screen.findByText("Lista de roles")).toBeInTheDocument();
  });

  it("confirmación cancelada ⇒ CERO requests (el borrado no se emite)", async () => {
    vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: LEGACY, error: null });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderPagina("/roles/4");

    await screen.findByLabelText("Nombre del rol");
    await user.click(screen.getByRole("button", { name: "Eliminar rol" }));

    expect(rolesApi.deleteRole).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nombre del rol")).toBeInTheDocument();
  });

  it("id inexistente (/roles/999 con PGRST116) ⇒ notFound amigable, sin crash", async () => {
    const sinFila = {
      code: "PGRST116",
      message: "JSON object requested, multiple (or no) rows returned",
    };
    vi.mocked(rolesApi.fetchRole).mockResolvedValue({ row: null, error: sinFila });
    renderPagina("/roles/999");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se encontró el registro.",
    );
    // La página no crashea: el banner convive con el form (patrón
    // DistributorFormPage), pero el submit está blindado por el guard de id.
    expect(rolesApi.updateRole).not.toHaveBeenCalled();
    expect(rolesApi.deleteRole).not.toHaveBeenCalled();
  });

  it("URL de edición inválida (/roles/abc) ⇒ sin fetch y estado amigable", async () => {
    renderPagina("/roles/abc");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se encontró el registro.",
    );
    expect(rolesApi.fetchRole).not.toHaveBeenCalled();
  });
});
