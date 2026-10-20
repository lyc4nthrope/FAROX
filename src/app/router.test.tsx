import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../features/auth/types";
import * as authApi from "../features/auth/api";
import * as distributorsApi from "../features/distributors/api";
import * as onboardingApi from "../features/onboarding/api";
import * as productsApi from "../features/products/api";
import * as profileApi from "../features/profile/api";
import * as storesApi from "../features/stores/api";
import { AuthProvider } from "./providers/AuthProvider";
import { AppRoutes } from "./router";

vi.mock("../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
  // D1 (T1.x): /register usa signUp y reenvío de confirmación — el barrel
  // del router ya las importa, así que el mock debe exportarlas COMPLETO.
  signUp: vi.fn(),
  resendConfirmationEmail: vi.fn(),
  // D2: /auth/callback canjea el código PKCE — mismo motivo que arriba.
  confirmEmailConfirmationCode: vi.fn(),
}));
// B5 (T5.2): /distributors ya no es placeholder — el api de la feature se
// mockea COMPLETO como en el resto de los tests: sin esto, el módulo real
// importa el cliente supabase, que valida el env en el arranque (V0-1).
vi.mock("../features/distributors/api", () => ({
  fetchDistributors: vi.fn(),
  fetchDistributor: vi.fn(),
  createDistributor: vi.fn(),
  updateDistributor: vi.fn(),
  deactivateDistributor: vi.fn(),
  deleteDistributor: vi.fn(),
}));
// B6 (T6.2): mismo motivo para /products — páginas reales en vez de
// placeholder, así que el api de la feature debe estar mockeado completo.
vi.mock("../features/products/api", () => ({
  fetchProducts: vi.fn(),
  fetchProduct: vi.fn(),
  fetchBrands: vi.fn(),
  fetchUnitTypes: vi.fn(),
  fetchProductCategories: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deactivateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));
vi.mock("../features/profile/api", () => ({
  fetchMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
}));
// D3 (T2.2/T2.7): el guard derivado OnboardingGate consulta la feature
// onboarding — mockeada COMPLETA como el resto (sin esto, el módulo real
// importa el cliente supabase, que valida el env en el arranque (V0-1)).
vi.mock("../features/onboarding/api", () => ({
  fetchOnboardingSignals: vi.fn(),
  registerDistributor: vi.fn(),
  createStore: vi.fn(),
  fetchStoreTypes: vi.fn(),
}));
// B7 (T7.2): /stores ya no es placeholder — el api de la feature se mockea
// COMPLETO como en el resto de los tests: sin esto, el módulo real importa el
// cliente supabase, que valida el env en el arranque (V0-1).
vi.mock("../features/stores/api", () => ({
  fetchStores: vi.fn(),
  fetchStore: vi.fn(),
  fetchStoreGeo: vi.fn(),
  fetchStoreTypes: vi.fn(),
  createStore: vi.fn(),
  updateStore: vi.fn(),
  deactivateStore: vi.fn(),
  deleteStore: vi.fn(),
}));

const SESSION = { userId: "u1", email: "demo@farox.app" };

function conSesion(role: RoleName | null) {
  vi.mocked(authApi.getSession).mockResolvedValue(SESSION);
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
}

function renderRuta(ruta: string) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("AppRoutes (V0-2/V0-4/§S2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    // D2: el canje PKCE del callback se resuelve "sin código" para que la
    // ruta monte su rama de error y el test verifique solo el GUARD PÚBLICO.
    vi.mocked(authApi.confirmEmailConfirmationCode).mockResolvedValue({
      status: "missing-code",
    });
    vi.mocked(profileApi.fetchMyProfile).mockResolvedValue({
      row: {
        full_name: "Ada Lovelace",
        phone_number: "555-1234",
        contact_preference: "whatsapp",
      },
      error: null,
    });
    vi.mocked(profileApi.updateMyProfile).mockResolvedValue({ error: null });
    vi.mocked(distributorsApi.fetchDistributors).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(distributorsApi.fetchDistributor).mockResolvedValue({ row: null, error: null });
    vi.mocked(productsApi.fetchProducts).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(productsApi.fetchProduct).mockResolvedValue({ row: null, error: null });
    vi.mocked(productsApi.fetchBrands).mockResolvedValue({ rows: [], error: null });
    vi.mocked(productsApi.fetchUnitTypes).mockResolvedValue({ rows: [], error: null });
    vi.mocked(productsApi.fetchProductCategories).mockResolvedValue({
      rows: [],
      error: null,
    });
    vi.mocked(storesApi.fetchStores).mockResolvedValue({
      rows: [],
      count: 0,
      error: null,
    });
    vi.mocked(storesApi.fetchStore).mockResolvedValue({ row: null, error: null });
    vi.mocked(storesApi.fetchStoreGeo).mockResolvedValue({ geo: null, error: null });
    vi.mocked(storesApi.fetchStoreTypes).mockResolvedValue({ rows: [], error: null });
    conSesion("admin");
    // D3 (T2.2): por defecto la sesión YA tiene señal (tienda propia) ⇒ el
    // guard derivado deja pasar al shell — así los tests preexistentes
    // conservan su significado. Los casos "sin señal" la mockean a pelo.
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: { hasDistributor: false, hasStore: true },
      error: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("anónimo en una ruta de datos: cae en /login con cero llamadas de datos (V0-2)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/stores");
    expect(await screen.findByText("Iniciar sesión")).toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("anónimo en /register: formulario de registro — ruta PÚBLICA sin RequireAuth (D1)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/register");
    // El form monta sin sesión: nunca cae al guard de /login.
    expect(
      await screen.findByRole("heading", { name: "Crear tu cuenta" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("anónimo en /auth/callback: pantalla del callback — ruta PÚBLICA sin RequireAuth (D2)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/auth/callback?code=abc123");
    // El callback monta sin sesión y sin privilegios: nunca cae al guard de /login.
    expect(
      await screen.findByRole("heading", { name: "No pudimos confirmar tu cuenta" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Iniciá sesión" }),
    ).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("heading", { name: "Iniciar sesión" })).not.toBeInTheDocument();
    expect(authApi.fetchPrivileges).not.toHaveBeenCalled();
  });

  it("cada ruta §S2 resuelve pantalla o placeholder explícito, nunca en blanco (V0-4)", async () => {
    const rutas = [
      "/",
      "/distributors",
      "/distributors/new",
      "/distributors/1",
      "/products",
      "/products/new",
      "/products/1",
      "/stores",
      "/stores/new",
      "/stores/1",
      "/users",
      "/profile",
    ];
    for (const ruta of rutas) {
      renderRuta(ruta);
      const main = await screen.findByRole("main");
      expect(main.textContent?.length, `ruta ${ruta}`).toBeGreaterThan(0);
      cleanup();
    }
  });

  it("ruta desconocida: placeholder explícito (V0-4)", async () => {
    renderRuta("/ruta/que/no/existe");
    expect(await screen.findByText("Página no encontrada")).toBeInTheDocument();
  });

  it("§S2: operador con /users por URL directa → denegado", async () => {
    conSesion("operador");
    renderRuta("/users");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
  });

  it("§S2: distribuidor con /stores por URL directa → denegado (SEC-01 tiendas NO)", async () => {
    conSesion("distribuidor");
    renderRuta("/stores");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
  });

  it("sesionado en /login: redirige al home con el rol visible", async () => {
    renderRuta("/login");
    const main = await screen.findByRole("main");
    expect(main).toHaveTextContent("Sesión iniciada como Administrador");
  });

  it("D3/T2.2: sesión sin tienda ni distributor ⇒ CUALQUIER ruta intercepta a /onboarding", async () => {
    // El guard derivado va tras RequireAuth: llegás autenticado a "/" (p. ej.
    // tras /auth/callback de D2, design #538 §8) y te manda a la pregunta.
    conSesion("operador");
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: { hasDistributor: false, hasStore: false },
      error: null,
    });
    renderRuta("/");
    expect(await screen.findByRole("heading", { name: "¿Qué sos?" })).toBeInTheDocument();
    expect(screen.queryByText("Sesión iniciada como")).not.toBeInTheDocument();
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(1);
  });

  it("D3/T2.2: sesión CON señal (distribuidor) ⇒ la pregunta jamás aparece: entra al home", async () => {
    conSesion("operador");
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: { hasDistributor: true, hasStore: false },
      error: null,
    });
    renderRuta("/");
    const main = await screen.findByRole("main");
    expect(main).toHaveTextContent("Sesión iniciada como");
    expect(screen.queryByRole("heading", { name: "¿Qué sos?" })).not.toBeInTheDocument();
  });

  it("D3/S-D3.0: con señal, visita directa a /onboarding ⇒ redirige al home (no reaparece)", async () => {
    renderRuta("/onboarding");
    const main = await screen.findByRole("main");
    expect(main).toHaveTextContent("Sesión iniciada como");
    expect(screen.queryByRole("heading", { name: "¿Qué sos?" })).not.toBeInTheDocument();
  });

  it("D3: anónimo ⇒ CERO llamadas de detección (el gate vive tras RequireAuth)", async () => {
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    renderRuta("/");
    expect(await screen.findByRole("heading", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(onboardingApi.fetchOnboardingSignals).not.toHaveBeenCalled();
  });
});
