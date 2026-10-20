import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as onboardingApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireAuth } from "../../../app/guards/RequireAuth";
import { OnboardingGate } from "./OnboardingGate";
import { OnboardingPage } from "./OnboardingPage";

// D3 completo mockeado de punta a punta (T2.3-T2.6, T2.8): pregunta de 2
// niveles + las 3 terminales. El árbol es el del router real (RequireAuth →
// OnboardingGate → página); "/onboarding" arranca SIEMPRE sin señales y los
// tests inyectan la señal resultante vía el mock de fetch (la terminal la
// relee con refresh() antes de navegar — S-D3.A/S-D3.B AC).
vi.mock("../api", () => ({
  fetchOnboardingSignals: vi.fn(),
  registerDistributor: vi.fn(),
  createStore: vi.fn(),
  fetchStoreTypes: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const SIN_SENAL = { hasDistributor: false, hasStore: false };
const CON_DISTRIBUTOR = { hasDistributor: true, hasStore: false };
const CON_TIENDA = { hasDistributor: false, hasStore: true };

// Formas REALES de fallos backend (RAISE de plpgsql / SQLSTATE): variables
// porque los literales con `code` chocarían con el excess-property check.
const ERROR_CAP1 = { code: "P0001", message: "ya tenés un distribuidor asociado" };
const ERROR_NIT_DUPLICADO = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "distributors_nit_key"',
};
const ERROR_RLS = { code: "42501", message: "permission denied for table stores" };

function renderOnboarding() {
  return render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <AuthProvider>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<OnboardingGate />}>
              {/* Stubs de destino: los terminales navegan a "/" tras su señal. */}
              <Route path="/" element={<p>llegaste al inicio</p>} />
              <Route path="/onboarding" element={<OnboardingPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

// Señal del REFRESH post-éxito: la terminal llama refresh() y DESPUÉS
// navega — el mock devuelve la identidad recién creada (S-D3.A/S-D3.B AC).
// ATENCIÓN al orden de los Once: el primer fetch es la lectura INICIAL del
// provider (sigue sin señal); el segundo es el refresh de la terminal.
function programarRefresh(conSenal: { hasDistributor: boolean; hasStore: boolean }) {
  vi.mocked(onboardingApi.fetchOnboardingSignals)
    .mockResolvedValueOnce({ signals: SIN_SENAL, error: null })
    .mockResolvedValueOnce({ signals: conSenal, error: null });
}

describe("OnboardingPage · pregunta de 2 niveles (T2.3, S-D3.0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium: false });
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: SIN_SENAL,
      error: null,
    });
    vi.mocked(onboardingApi.registerDistributor).mockResolvedValue({ id: 1, error: null });
    vi.mocked(onboardingApi.createStore).mockResolvedValue({ error: null });
    vi.mocked(onboardingApi.fetchStoreTypes).mockResolvedValue({
      rows: [{ id: 1, name: "Minimercado" }],
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("nivel 1 visible sin señales: ¿Qué sos? con [Distribuidor] | [Tienda] (S-D3.0)", async () => {
    renderOnboarding();

    expect(await screen.findByRole("heading", { name: "¿Qué sos?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Distribuidor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tienda" })).toBeInTheDocument();
  });

  it("Tienda abre el nivel 2 [Mi tienda] | [Trabajo en tienda]; Volver regresa al nivel 1", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("button", { name: "Tienda" }));

    expect(await screen.findByRole("heading", { name: "¿Ya tenés tu tienda?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mi tienda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trabajo en tienda" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Volver" }));

    expect(await screen.findByRole("heading", { name: "¿Qué sos?" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "¿Ya tenés tu tienda?" })).not.toBeInTheDocument();
  });
});

describe("OnboardingPage · terminal [Distribuidor] → register_distributor (T2.4, S-D3.A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium: false });
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: SIN_SENAL,
      error: null,
    });
    vi.mocked(onboardingApi.registerDistributor).mockResolvedValue({ id: 1, error: null });
    vi.mocked(onboardingApi.fetchStoreTypes).mockResolvedValue({ rows: [], error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("éxito: register_distributor con NIT ⇒ revalida rol, setea la señal y entra al inicio (la pregunta NO reaparece)", async () => {
    programarRefresh(CON_DISTRIBUTOR);
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("button", { name: "Distribuidor" }));
    await user.type(screen.getByLabelText("Nombre"), "Distribuidora Sur");
    await user.type(screen.getByLabelText("NIT"), "900123456-7");
    await user.click(screen.getByRole("button", { name: "Registrarme como distribuidor" }));

    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    expect(onboardingApi.registerDistributor).toHaveBeenCalledWith({
      name: "Distribuidora Sur",
      nit: "900123456-7",
      contact_name: "",
      phone: "",
      email: "",
      contact_preference: "whatsapp",
    });
    // refreshPrivileges: el rol acaba de cambiar a distribuidor (M11) ⇒ el
    // AuthProvider relee privilegios ANTES de entrar al app (T2.4).
    expect(authApi.fetchPrivileges).toHaveBeenCalledTimes(2);
    // refresh() releyó la señal con distributor presente ⇒ sin rebote al guard.
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: "¿Qué sos?" })).not.toBeInTheDocument();
  });

  it("sin NIT: error inline y CERO requests (0003:16 UNIQUE NOT NULL, idea:198)", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("button", { name: "Distribuidor" }));
    await user.type(screen.getByLabelText("Nombre"), "Distribuidora Sur");
    await user.click(screen.getByRole("button", { name: "Registrarme como distribuidor" }));

    expect(await screen.findByText("Ingresá el NIT")).toBeInTheDocument();
    expect(onboardingApi.registerDistributor).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Registrarme como distribuidor" })).toBeInTheDocument();
  });

  it("cap-1 (ya tenés un distribuidor): mensaje MAPEADO, jamás el crudo, sin navegación", async () => {
    vi.mocked(onboardingApi.registerDistributor).mockResolvedValue({
      id: null,
      error: ERROR_CAP1,
    });
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("button", { name: "Distribuidor" }));
    await user.type(screen.getByLabelText("Nombre"), "Distribuidora Sur");
    await user.type(screen.getByLabelText("NIT"), "900123456-7");
    await user.click(screen.getByRole("button", { name: "Registrarme como distribuidor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ocurrió un error inesperado. Intentá de nuevo.",
    );
    expect(screen.queryByText(/distribuidor asociado/)).not.toBeInTheDocument();
    // Sigo en el form (retry) y sin refetch de señales.
    expect(screen.getByRole("button", { name: "Registrarme como distribuidor" })).toBeInTheDocument();
    expect(screen.queryByText("llegaste al inicio")).not.toBeInTheDocument();
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(1);
  });

  it("NIT duplicado (unique_violation): mensaje MAPEADO, nunca el crudo del constraint", async () => {
    vi.mocked(onboardingApi.registerDistributor).mockResolvedValue({
      id: null,
      error: ERROR_NIT_DUPLICADO,
    });
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("button", { name: "Distribuidor" }));
    await user.type(screen.getByLabelText("Nombre"), "Distribuidora Sur");
    await user.type(screen.getByLabelText("NIT"), "900123456-7");
    await user.click(screen.getByRole("button", { name: "Registrarme como distribuidor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ocurrió un error inesperado. Intentá de nuevo.",
    );
    expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument();
    expect(screen.queryByText("llegaste al inicio")).not.toBeInTheDocument();
  });
});

describe("OnboardingPage · terminal [Mi tienda] → create_store (T2.5, S-D3.B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium: false });
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: SIN_SENAL,
      error: null,
    });
    vi.mocked(onboardingApi.createStore).mockResolvedValue({ error: null });
    vi.mocked(onboardingApi.fetchStoreTypes).mockResolvedValue({
      rows: [{ id: 1, name: "Minimercado" }],
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  async function abrirTerminalMiTienda(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole("button", { name: "Tienda" }));
    await user.click(await screen.findByRole("button", { name: "Mi tienda" }));
    // El catálogo carga por useEffect: esperar el form evita tipear en un
    // select todavía no montado (lección #509 del patrón B6/B7).
    await screen.findByRole("button", { name: "Crear mi tienda" });
  }

  it("sin ubicación: Zod bloquea con errores inline y CERO requests (0002:131 NOT NULL)", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await abrirTerminalMiTienda(user);

    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.click(screen.getByRole("button", { name: "Crear mi tienda" }));

    expect(await screen.findByText("Ingresá una latitud válida entre -90 y 90")).toBeInTheDocument();
    expect(screen.getByText("Ingresá una longitud válida entre -180 y 180")).toBeInTheDocument();
    expect(onboardingApi.createStore).not.toHaveBeenCalled();
  });

  it("éxito: createStore con la ubicación obligatoria ⇒ setea la señal y entra al inicio", async () => {
    programarRefresh(CON_TIENDA);
    const user = userEvent.setup();
    renderOnboarding();
    await abrirTerminalMiTienda(user);

    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.type(screen.getByLabelText("Latitud (-90 a 90)"), "4.6097");
    await user.type(screen.getByLabelText("Longitud (-180 a 180)"), "-74.0631");
    await user.click(screen.getByRole("button", { name: "Crear mi tienda" }));

    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    // Payload mínimo (sin duplicar el CRUD de B7): nombre, tipo y coordenadas
    // tal como las tipeó el usuario — el EWKT lng-first se arma en la capa api
    // (cubierto en api.test.ts).
    expect(onboardingApi.createStore).toHaveBeenCalledWith({
      name: "Tienda Centro",
      store_type_id: "1",
      lat: "4.6097",
      lng: "-74.0631",
    });
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: "¿Qué sos?" })).not.toBeInTheDocument();
  });

  it("alta denegada (42501): mensaje mapeado, sin falso éxito ni navegación (HARD-1)", async () => {
    vi.mocked(onboardingApi.createStore).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderOnboarding();
    await abrirTerminalMiTienda(user);

    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.type(screen.getByLabelText("Latitud (-90 a 90)"), "4.6097");
    await user.type(screen.getByLabelText("Longitud (-180 a 180)"), "-74.0631");
    await user.click(screen.getByRole("button", { name: "Crear mi tienda" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tenés permisos para esta operación.",
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear mi tienda" })).toBeInTheDocument();
    expect(screen.queryByText("llegaste al inicio")).not.toBeInTheDocument();
  });
});

describe("OnboardingPage · terminal [Trabajo en tienda] → pasiva (T2.6, S-D3.C)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium: false });
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: SIN_SENAL,
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("pasiva: CERO llamadas de mutación; el ack entra al inicio solo con la señal inicial leída", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("button", { name: "Tienda" }));
    await user.click(await screen.findByRole("button", { name: "Trabajo en tienda" }));

    expect(
      await screen.findByText(/un administrador te va a asignar las tiendas/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Entendido" }));

    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    // Sin RPC de creación de ningún tipo — la asignación es admin-only
    // (assign_user_stores, 0011:143-159).
    expect(onboardingApi.registerDistributor).not.toHaveBeenCalled();
    expect(onboardingApi.createStore).not.toHaveBeenCalled();
    // Sin señal persistente ⇒ refresh() no se llama: solo la lectura inicial.
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(1);
  });

  it("la pregunta VUELVE en el próximo arranque sin tiendas (S-D3.C: re-preguntar es deseado)", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("button", { name: "Tienda" }));
    await user.click(await screen.findByRole("button", { name: "Trabajo en tienda" }));
    await user.click(await screen.findByRole("button", { name: "Entendido" }));
    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    cleanup();

    // Segundo arranque (nueva sesión, el admin todavía no asignó tiendas):
    // el ack era solo de sesión ⇒ la pregunta aparece de nuevo.
    renderOnboarding();

    expect(await screen.findByRole("heading", { name: "¿Qué sos?" })).toBeInTheDocument();
  });

  it("tras la asignación del admin (my_store_ids no vacío) la pregunta NO vuelve", async () => {
    // Mismo segundo arranque, pero ahora el admin ya asignó la tienda:
    // la señal derivada existe y el guard deja pasar sin preguntar.
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: CON_TIENDA,
      error: null,
    });

    renderOnboarding();

    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "¿Qué sos?" })).not.toBeInTheDocument();
  });
});
