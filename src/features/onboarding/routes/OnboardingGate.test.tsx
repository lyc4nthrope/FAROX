import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as onboardingApi from "../api";
import { clearOnboardingSignalsCache, writeCachedOnboardingSignals } from "../signalsCache";
import { RequireAuth } from "../../../app/guards/RequireAuth";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { OnboardingGate } from "./OnboardingGate";

// Guard DERIVADO (T2.2 · R-D3.1 · design #538 §5.2/§8): el layout va TRAS
// RequireAuth y decide entre el contenido y la pregunta según las señales
// (my_distributor_id / my_store_ids / stores.created_by). La capa api de la
// feature se mockea COMPLETA: el módulo real importa el cliente supabase,
// que valida el env al importar (V0-1).
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
const CON_TIENDA = { hasDistributor: false, hasStore: true };

// El harness es la MISMA estructura que el router real: RequireAuth →
// OnboardingGate → rutas. El "shell" se stubea con texto para que los
// asertos apunten al guard, no al AppShell.
function renderRuta(entrada: string) {
  return render(
    <MemoryRouter initialEntries={[entrada]}>
      <AuthProvider>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route element={<OnboardingGate />}>
              <Route path="/" element={<p>contenido de la app</p>} />
              <Route path="/onboarding" element={<p>pantalla de onboarding</p>} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("OnboardingGate (T2.2 · guard derivado post-RequireAuth)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // La caché en memoria de señales es estado de módulo: cada test arranca
    // sin ella (aislamiento entre specs).
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

  it("sin señal: llegando a CUALQUIER ruta autenticada (p. ej. '/') intercepta a /onboarding", async () => {
    renderRuta("/");

    expect(await screen.findByText("pantalla de onboarding")).toBeInTheDocument();
    expect(screen.queryByText("contenido de la app")).not.toBeInTheDocument();
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(1);
  });

  it("sin señal: visita directa a /onboarding se queda en la pregunta", async () => {
    renderRuta("/onboarding");

    expect(await screen.findByText("pantalla de onboarding")).toBeInTheDocument();
    expect(screen.queryByText("contenido de la app")).not.toBeInTheDocument();
  });

  it("con señal (tienda propia): deja pasar al contenido — la pregunta jamás aparece", async () => {
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: CON_TIENDA,
      error: null,
    });

    renderRuta("/");

    expect(await screen.findByText("contenido de la app")).toBeInTheDocument();
    expect(screen.queryByText("pantalla de onboarding")).not.toBeInTheDocument();
  });

  it("con señal: visita directa a /onboarding ⇒ redirige al contenido (S-D3.0: no reaparece)", async () => {
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: { hasDistributor: true, hasStore: false },
      error: null,
    });

    renderRuta("/onboarding");

    expect(await screen.findByText("contenido de la app")).toBeInTheDocument();
    expect(screen.queryByText("pantalla de onboarding")).not.toBeInTheDocument();
  });

  it("error de detección: banner MAPEADO (nunca texto crudo) + Reintentar vuelve a consultar", async () => {
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValueOnce({
      signals: null,
      error: { code: "42501", message: "permission denied raw" },
    });
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValueOnce({
      signals: CON_TIENDA,
      error: null,
    });
    const user = userEvent.setup();

    renderRuta("/");

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("No tenés permisos para esta operación.");
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    // Sin adivinar: ni contenido ni pregunta hasta el retry explícito.
    expect(screen.queryByText("contenido de la app")).not.toBeInTheDocument();
    expect(screen.queryByText("pantalla de onboarding")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("contenido de la app")).toBeInTheDocument();
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(2);
  });

  it("mientras la detección resuelve: estado de carga, sin redirección", async () => {
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockReturnValue(new Promise(() => {}));

    renderRuta("/");

    // findBy: la sesión se resuelve en un tick previo (RequireAuth) — el
    // estado "Cargando tu perfil…" del gate persiste porque la promesa de
    // detección nunca se cumple.
    expect(await screen.findByText("Cargando tu perfil…")).toBeInTheDocument();
    expect(screen.queryByText("pantalla de onboarding")).not.toBeInTheDocument();
    expect(screen.queryByText("contenido de la app")).not.toBeInTheDocument();
  });

  // ── Remount sin blanquear (caché en memoria de señales) ───────────────────
  // Regresión de "la página se recarga al cambiar de pestaña": un remount del
  // layout debe pintar el Outlet de INMEDIATO con la última señal conocida y
  // revalidar en background — jamás volver a "Cargando tu perfil…".

  it("con caché: el remount pinta el Outlet SIN 'Cargando tu perfil…' y revalida en background", async () => {
    writeCachedOnboardingSignals("u1", CON_TIENDA);
    // Fetch que NUNCA se resuelve: si el contenido aparece igual, el gate se
    // hidrató desde la caché sin esperar la red.
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockReturnValue(new Promise(() => {}));

    renderRuta("/");

    expect(await screen.findByText("contenido de la app")).toBeInTheDocument();
    expect(screen.queryByText("Cargando tu perfil…")).not.toBeInTheDocument();
    expect(screen.queryByText("pantalla de onboarding")).not.toBeInTheDocument();
    // El refresh de fondo corrió igual (una sola consulta).
    expect(onboardingApi.fetchOnboardingSignals).toHaveBeenCalledTimes(1);
  });

  it("con caché de SIN_SEÑAL: también hidrata — la pregunta aparece sin pasar por loading", async () => {
    writeCachedOnboardingSignals("u1", SIN_SENAL);
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockReturnValue(new Promise(() => {}));

    renderRuta("/");

    expect(await screen.findByText("pantalla de onboarding")).toBeInTheDocument();
    expect(screen.queryByText("Cargando tu perfil…")).not.toBeInTheDocument();
  });

  it("la caché es POR USUARIO: señales de otra cuenta no se hidratan (sin respuestas ajenas)", async () => {
    writeCachedOnboardingSignals("u-distinto", CON_TIENDA);
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockReturnValue(new Promise(() => {}));

    renderRuta("/");

    expect(await screen.findByText("Cargando tu perfil…")).toBeInTheDocument();
    expect(screen.queryByText("contenido de la app")).not.toBeInTheDocument();
  });

  it("con caché: si el refresh de fondo falla, NO se blanquea la app (conserva la última señal conocida)", async () => {
    writeCachedOnboardingSignals("u1", CON_TIENDA);
    vi.mocked(onboardingApi.fetchOnboardingSignals).mockResolvedValue({
      signals: null,
      error: { code: "42501", message: "permission denied raw" },
    });

    renderRuta("/");

    expect(await screen.findByText("contenido de la app")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});
