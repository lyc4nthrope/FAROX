import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as onboardingApi from "../api";
import { clearOnboardingSignalsCache } from "../signalsCache";
import * as nominatim from "../../../shared/lib/geo/nominatim";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { RequireAuth } from "../../../app/guards/RequireAuth";
import { OnboardingGate } from "./OnboardingGate";
import { OnboardingPage } from "./OnboardingPage";

// D3 completo mockeado de punta a punta (T2.3-T2.6, T2.8): pregunta de 2
// niveles + las 3 terminales. El árbol es el del router real (RequireAuth →
// OnboardingGate → página); "/onboarding" arranca SIEMPRE sin señales y los
// tests inyectan la señal resultante vía el mock de fetch (la terminal la
// relee con refresh() antes de navegar — S-D3.A/S-D3.B AC).
// Flujo v2 (full-screen): elegir una opción solo la SELECCIONA (bloque
// superior dinámico + habilitar [Seleccionar]); [Seleccionar] es el único
// que avanza de paso.
// El picker del mapa se mockea a nivel de MapLocationField (sin Leaflet ni
// tiles reales en jsdom): el mock expone "Poner pin" que emite la ubicación
// como lo haría el mapa. El reverse geocode (nominatim) también se mockea.
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
vi.mock("../../../shared/lib/geo/nominatim", () => ({
  reverseGeocode: vi.fn(),
}));
vi.mock("../../../shared/ui/LocationPicker/MapLocationField", () => ({
  MapLocationField: ({
    latitude,
    longitude,
    address,
    latitudeError,
    longitudeError,
    onLocationChange,
  }: {
    latitude: string;
    longitude: string;
    address?: string;
    latitudeError?: string;
    longitudeError?: string;
    onLocationChange: (next: { latitude: number; longitude: number }) => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onLocationChange({ latitude: 4.6097, longitude: -74.0631 })}
      >
        Poner pin
      </button>
      <output>{`${latitude},${longitude}`}</output>
      {address !== undefined && address !== "" && <p>Dirección resuelta: {address}</p>}
      {latitudeError !== undefined && <p>{latitudeError}</p>}
      {longitudeError !== undefined && <p>{longitudeError}</p>}
    </div>
  ),
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

// Flujo v2: clic en la opción = SELECCIÓN (no navega); [Seleccionar] avanza.
async function elegir(user: ReturnType<typeof userEvent.setup>, opcion: string) {
  await user.click(await screen.findByRole("radio", { name: opcion }));
  await user.click(screen.getByRole("button", { name: "Seleccionar" }));
}

describe("OnboardingPage · pregunta de 2 niveles (T2.3, S-D3.0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // El gate hidrata señales desde su caché en memoria por userId: cada
    // test arranca sin ella para que el mock de fetch mande solo.
    clearOnboardingSignalsCache();
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

  it("nivel 1 sin selección: título + copy base + radiogroup; [Seleccionar] deshabilitado (S-D3.0)", async () => {
    renderOnboarding();

    expect(await screen.findByRole("heading", { name: "Bienvenido a FAROX" })).toBeInTheDocument();
    expect(
      screen.getByText(/FAROX conecta a los distribuidores con las tiendas/),
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "¿Qué sos?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Distribuidor" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tienda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar" })).toBeDisabled();
  });

  it("[Seleccionar] sin selección NO hace nada: deshabilitado y sin navegación (requisito v2)", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    const seleccionar = await screen.findByRole("button", { name: "Seleccionar" });
    expect(seleccionar).toBeDisabled();
    await user.click(seleccionar);

    expect(screen.getByRole("heading", { name: "Bienvenido a FAROX" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Contanos sobre tu relación con la tienda" }),
    ).not.toBeInTheDocument();
  });

  it("elegir una opción actualiza el bloque superior y habilita [Seleccionar] SIN navegar", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    expect(
      await screen.findByText(/FAROX conecta a los distribuidores con las tiendas/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Distribuidor" }));

    expect(
      await screen.findByText(/Trabajás con productos y las tiendas te piden catálogo/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar" })).toBeEnabled();
    // Elegir NO dispara la terminal: seguimos en el nivel 1.
    expect(screen.getByRole("heading", { name: "Bienvenido a FAROX" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Registro de distribuidor" }),
    ).not.toBeInTheDocument();
  });

  it("nivel 2: el bloque superior también cambia con la selección (Mi tienda) sin navegar", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await elegir(user, "Tienda");

    expect(
      await screen.findByRole("heading", { name: "Contanos sobre tu relación con la tienda" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Esto define qué podés hacer desde hoy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Mi tienda" }));

    expect(await screen.findByText(/Sos responsable del negocio/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seleccionar" })).toBeEnabled();
    // Seguimos en el nivel 2: la terminal [Mi tienda] todavía no abrió.
    expect(screen.queryByRole("heading", { name: "Creá tu tienda" })).not.toBeInTheDocument();
  });

  it("Tienda + [Seleccionar] abre el nivel 2 [Mi tienda] | [Trabajo en tienda]; Volver regresa al nivel 1", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("radio", { name: "Tienda" }));
    await user.click(screen.getByRole("button", { name: "Seleccionar" }));

    expect(
      await screen.findByRole("heading", { name: "Contanos sobre tu relación con la tienda" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "¿Ya tenés tu tienda?" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Mi tienda" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Trabajo en tienda" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Volver" }));

    expect(await screen.findByRole("heading", { name: "Bienvenido a FAROX" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Contanos sobre tu relación con la tienda" }),
    ).not.toBeInTheDocument();
    // La remonta por key={step} limpia la selección: hay que volver a elegir.
    expect(screen.getByRole("button", { name: "Seleccionar" })).toBeDisabled();
  });

  it("teclado: Tab entra al radiogroup y las flechas mueven y seleccionan", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await screen.findByRole("heading", { name: "Bienvenido a FAROX" });

    await user.tab();
    expect(screen.getByRole("radio", { name: "Distribuidor" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    const tienda = screen.getByRole("radio", { name: "Tienda" });
    expect(tienda).toHaveFocus();
    expect(tienda).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Distribuidor" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("button", { name: "Seleccionar" })).toBeEnabled();

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Distribuidor" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("button", { name: "Seleccionar" })).toBeEnabled();
  });

  it("[Salir] reutiliza el signOut del AppShell (AuthProvider) — nunca quedás atrapado", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await user.click(await screen.findByRole("button", { name: "Salir" }));

    expect(authApi.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("OnboardingPage · terminal [Distribuidor] → register_distributor (T2.4, S-D3.A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Cada describe comparte el userId "u1": sin este clear, la caché en
    // memoria del gate hidrataría señales del describe anterior.
    clearOnboardingSignalsCache();
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

    await elegir(user, "Distribuidor");
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
    expect(screen.queryByRole("heading", { name: "Bienvenido a FAROX" })).not.toBeInTheDocument();
  });

  it("sin NIT: error inline y CERO requests (0003:16 UNIQUE NOT NULL, idea:198)", async () => {
    const user = userEvent.setup();
    renderOnboarding();

    await elegir(user, "Distribuidor");
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

    await elegir(user, "Distribuidor");
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

    await elegir(user, "Distribuidor");
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
    // Cada describe comparte el userId "u1": sin este clear, la caché en
    // memoria del gate hidrataría señales del describe anterior.
    clearOnboardingSignalsCache();
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
    // Best-effort por defecto: sin dirección resuelta (p_address ⇒ NULL).
    vi.mocked(nominatim.reverseGeocode).mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  async function abrirTerminalMiTienda(user: ReturnType<typeof userEvent.setup>) {
    // Flujo v2: seleccionar (no navega) + [Seleccionar] en cada nivel.
    await elegir(user, "Tienda");
    await elegir(user, "Mi tienda");
    // El catálogo carga por useEffect: esperar el form evita tipear en un
    // select todavía no montado (lección #509 del patrón B6/B7).
    await screen.findByRole("button", { name: "Crear mi tienda" });
  }

  it("sin pin en el mapa: Zod bloquea con errores inline y CERO requests (0002:131 NOT NULL)", async () => {
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

  it("éxito: createStore con la ubicación del pin ⇒ setea la señal y entra al inicio", async () => {
    programarRefresh(CON_TIENDA);
    const user = userEvent.setup();
    renderOnboarding();
    await abrirTerminalMiTienda(user);

    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    // El MAPA es el input de coordenadas (mockeado): colocar el pin emite
    // { latitude, longitude } — el contenedor los serializa a string.
    await user.click(screen.getByRole("button", { name: "Poner pin" }));
    expect(await screen.findByText("4.6097,-74.0631")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear mi tienda" }));

    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    // Payload mínimo (sin duplicar el CRUD de B7): nombre, tipo y coordenadas
    // del pin — el EWKT lng-first se arma en la capa api (cubierto en
    // api.test.ts). address queda "" sin resolver ⇒ p_address NULL.
    expect(onboardingApi.createStore).toHaveBeenCalledWith({
      name: "Tienda Centro",
      store_type_id: "1",
      lat: "4.6097",
      lng: "-74.0631",
      address: "",
    });
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: "Bienvenido a FAROX" })).not.toBeInTheDocument();
  });

  it("pin → reverse geocode diferido: p_address viaja con la dirección resuelta", async () => {
    // ADD (map picker): el pin dispara Nominatim tras el debounce (~800ms) y
    // el resultado completa el form → createStore lo pasa a p_address (que
    // antes era el null hardcodeado).
    vi.mocked(nominatim.reverseGeocode).mockResolvedValue({
      latitude: 4.6097,
      longitude: -74.0631,
      address: "Carrera 7 #1-1, Bogotá",
    });
    programarRefresh(CON_TIENDA);
    const user = userEvent.setup();
    renderOnboarding();
    await abrirTerminalMiTienda(user);

    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.click(screen.getByRole("button", { name: "Poner pin" }));

    expect(await screen.findByText("Dirección resuelta: Carrera 7 #1-1, Bogotá")).toBeInTheDocument();
    expect(nominatim.reverseGeocode).toHaveBeenCalledWith(4.6097, -74.0631);
    await user.click(screen.getByRole("button", { name: "Crear mi tienda" }));

    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    expect(onboardingApi.createStore).toHaveBeenCalledWith(
      expect.objectContaining({ address: "Carrera 7 #1-1, Bogotá" }),
    );
  });

  it("Nominatim falla (best-effort): p_address viaja NULL y la alta PROCEDE igual", async () => {
    vi.mocked(nominatim.reverseGeocode).mockResolvedValue(null);
    programarRefresh(CON_TIENDA);
    const user = userEvent.setup();
    renderOnboarding();
    await abrirTerminalMiTienda(user);

    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.click(screen.getByRole("button", { name: "Poner pin" }));

    expect(await screen.findByText("4.6097,-74.0631")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear mi tienda" }));

    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    expect(onboardingApi.createStore).toHaveBeenCalledWith(
      expect.objectContaining({ address: "" }),
    );
  });

  it("alta denegada (42501): mensaje mapeado, sin falso éxito ni navegación (HARD-1)", async () => {
    vi.mocked(onboardingApi.createStore).mockResolvedValue({ error: ERROR_RLS });
    const user = userEvent.setup();
    renderOnboarding();
    await abrirTerminalMiTienda(user);

    await user.type(screen.getByLabelText("Nombre"), "Tienda Centro");
    await user.selectOptions(screen.getByLabelText("Tipo de tienda"), "1");
    await user.click(screen.getByRole("button", { name: "Poner pin" }));
    await screen.findByText("4.6097,-74.0631");
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
    // Cada describe comparte el userId "u1": sin este clear, la caché en
    // memoria del gate hidrataría señales del describe anterior.
    clearOnboardingSignalsCache();
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

    await elegir(user, "Tienda");
    await elegir(user, "Trabajo en tienda");

    expect(
      await screen.findByText(/no vas a ver pedidos ni stock/),
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

    await elegir(user, "Tienda");
    await elegir(user, "Trabajo en tienda");
    await user.click(await screen.findByRole("button", { name: "Entendido" }));
    expect(await screen.findByText("llegaste al inicio")).toBeInTheDocument();
    cleanup();

    // Segundo arranque (nueva sesión, el admin todavía no asignó tiendas):
    // el ack era solo de sesión ⇒ la pregunta aparece de nuevo.
    renderOnboarding();

    expect(await screen.findByRole("heading", { name: "Bienvenido a FAROX" })).toBeInTheDocument();
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
    expect(screen.queryByRole("heading", { name: "Bienvenido a FAROX" })).not.toBeInTheDocument();
  });
});
