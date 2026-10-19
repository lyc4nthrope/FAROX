import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../auth/types";
import * as authApi from "../../auth/api";
import * as distributorsApi from "../api";
import type { DistributorRow } from "../types";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { DistributorFormPage } from "./DistributorFormPage";
import { DistributorsPage } from "./DistributorsPage";

// D7 (componente, api de la feature mockeada COMPLETA): los escenarios de
// escritura de DIST-1 (spec #483 S4). /distributors usa la página REAL para
// probar "la fila aparece en la lista tras el refetch" (HARD-3, D4).
vi.mock("../api", () => ({
  fetchDistributors: vi.fn(),
  fetchDistributor: vi.fn(),
  createDistributor: vi.fn(),
  updateDistributor: vi.fn(),
  deactivateDistributor: vi.fn(),
  deleteDistributor: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const D1: DistributorRow = {
  id: 1,
  name: "Distribuidora Andes",
  nit: "900123456",
  is_active: true,
  contact_name: "Ana Pérez",
  phone: "555-0001",
  email: "ana@andes.example",
  contact_preference: "email",
};

// Forma REAL de una denegación PostgREST/RLS: SQLSTATE 42501 en `code`
// (misma forma canónica que mapError.test.ts / useList.test.tsx). Variable
// porque el literal con `code` chocaría con el excess-property check de TS.
const ERROR_RLS = { code: "42501", message: "permission denied for table distributors" };

function renderRutas(entrada: string, role: RoleName) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <AuthProvider>
        <Routes>
          <Route path="/distributors" element={<DistributorsPage />} />
          <Route path="/distributors/new" element={<DistributorFormPage />} />
          <Route path="/distributors/:id" element={<DistributorFormPage />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function completarAlta(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(await screen.findByLabelText("Nombre"), "Distribuidora Andes");
  await user.type(screen.getByLabelText("NIT"), "900123456");
}

describe("DistributorFormPage (DIST-1 · §S2 fila Distributor form)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(distributorsApi.fetchDistributor).mockResolvedValue({ row: null, error: null });
    vi.mocked(distributorsApi.createDistributor).mockResolvedValue({ error: null });
    vi.mocked(distributorsApi.updateDistributor).mockResolvedValue({ error: null });
    vi.mocked(distributorsApi.deactivateDistributor).mockResolvedValue({ error: null });
    vi.mocked(distributorsApi.deleteDistributor).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("admin crea un distribuidor y la fila aparece en la lista tras el refetch (DIST-1)", async () => {
    // 1.er mount de la lista: vacía. Tras crear, el re-entrada de la ruta
    // vuelve a pedir y ahora la fila existe (refetch, sin realtime).
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValueOnce({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValueOnce({
      rows: [{ id: 7, name: "Distribuidora Andes", nit: "900123456", is_active: true }],
      count: 1,
      error: null,
    });
    const user = userEvent.setup();
    renderRutas("/distributors", "admin");

    expect(await screen.findByText("No hay distribuidores todavía")).toBeInTheDocument();
    // El control depende del rol (admin): esperarlo con findBy porque la
    // sesión resuelve de forma asíncrona (AuthProvider → fetchPrivileges).
    await user.click(await screen.findByRole("link", { name: "Nuevo distribuidor" }));

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear distribuidor" }));

    expect(await screen.findByRole("link", { name: "Distribuidora Andes" })).toBeInTheDocument();
    expect(distributorsApi.createDistributor).toHaveBeenCalledTimes(1);
    const [values] = vi.mocked(distributorsApi.createDistributor).mock.calls[0];
    expect(values).toEqual({
      name: "Distribuidora Andes",
      nit: "900123456",
      contact_name: "",
      phone: "",
      email: "",
      contact_preference: "whatsapp",
    });
    expect(distributorsApi.fetchDistributors).toHaveBeenCalledTimes(2);
  });

  it("campos obligatorios vacíos: errores inline y CERO requests (idea:198)", async () => {
    const user = userEvent.setup();
    renderRutas("/distributors/new", "admin");

    await user.click(await screen.findByRole("button", { name: "Crear distribuidor" }));

    expect(await screen.findByText("Ingresá el nombre del distribuidor")).toBeInTheDocument();
    expect(screen.getByText("Ingresá el NIT")).toBeInTheDocument();
    expect(distributorsApi.createDistributor).not.toHaveBeenCalled();
  });

  it("email inválido: error inline y CERO requests (Zod por formulario, idea:198)", async () => {
    const user = userEvent.setup();
    renderRutas("/distributors/new", "admin");

    await completarAlta(user);
    await user.type(screen.getByLabelText("Email"), "no-es-un-email");
    await user.click(await screen.findByRole("button", { name: "Crear distribuidor" }));

    expect(await screen.findByText("Ingresá un email válido")).toBeInTheDocument();
    expect(distributorsApi.createDistributor).not.toHaveBeenCalled();
  });

  it("escritura forzada denegada (42501): mensaje amigable, sin texto crudo, sin navegación (DIST-1)", async () => {
    vi.mocked(distributorsApi.createDistributor).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderRutas("/distributors/new", "admin");

    await completarAlta(user);
    await user.click(await screen.findByRole("button", { name: "Crear distribuidor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    // Sigo en el formulario: no hubo navegación de éxito.
    expect(screen.getByRole("button", { name: "Crear distribuidor" })).toBeInTheDocument();
  });

  it("borrar en DOS pasos: desactiva y DESPUÉS borra, en ese orden (0006:133-135)", async () => {
    vi.mocked(distributorsApi.fetchDistributor).mockResolvedValue({ row: D1, error: null });
    const user = userEvent.setup();
    renderRutas("/distributors/1", "admin");

    await user.click(await screen.findByRole("button", { name: "Eliminar distribuidor" }));

    // "listado de distribuidores" NO existe en la UI: esa frase solo vive en un
    // comentario (DistributorList.tsx:16). El título real del listado es
    // <h1>Distribuidores</h1> (DistributorsPage.tsx:18), que el form de edición
    // jamás renderiza (su h1 es "Distribuidor", DistributorFormPage.tsx:169-171).
    // Prueba estructural de que navigate("/distributors") salió del form al listado.
    expect(await screen.findByRole("heading", { name: "Distribuidores" })).toBeInTheDocument();
    expect(distributorsApi.deactivateDistributor).toHaveBeenCalledWith(1);
    expect(distributorsApi.deleteDistributor).toHaveBeenCalledWith(1);
    const ordenDesactivar =
      vi.mocked(distributorsApi.deactivateDistributor).mock.invocationCallOrder[0];
    const ordenBorrar = vi.mocked(distributorsApi.deleteDistributor).mock.invocationCallOrder[0];
    expect(ordenDesactivar).toBeLessThan(ordenBorrar);
  });

  it("si la desactivación falla, el paso 2 NO corre y el error es amigable", async () => {
    vi.mocked(distributorsApi.fetchDistributor).mockResolvedValue({ row: D1, error: null });
    vi.mocked(distributorsApi.deactivateDistributor).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderRutas("/distributors/1", "admin");

    await user.click(await screen.findByRole("button", { name: "Eliminar distribuidor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(distributorsApi.deleteDistributor).not.toHaveBeenCalled();
    // Misma prueba estructural que el caso feliz, en negativo: el título del
    // listado NUNCA aparece porque no hubo navegación (antes el locator era una
    // frase que jamás se renderiza ⇒ aserción vacua).
    expect(screen.queryByRole("heading", { name: "Distribuidores" })).not.toBeInTheDocument();
  });

  it("operador en /distributors/:id: datos cargados en modo solo lectura, sin controles (SEC-01)", async () => {
    vi.mocked(distributorsApi.fetchDistributor).mockResolvedValue({ row: D1, error: null });
    renderRutas("/distributors/1", "operador");

    expect(await screen.findByDisplayValue("Distribuidora Andes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("900123456")).toBeInTheDocument();
    expect(screen.getByText("Vista de solo lectura: solo un administrador puede editar distribuidores.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar distribuidor" })).not.toBeInTheDocument();
  });
});
