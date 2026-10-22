import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { PRIVACY_VERSION } from "../../../shared/lib/legal/privacyVersion";
import { RegisterPage } from "./RegisterPage";

// D1: /register es pública — el harness monta SOLO RegisterPage (sin
// RequireAuth). El api de la feature se mockea COMPLETO como en el resto de
// la suite (sin esto, el módulo real importa el cliente supabase, que valida
// el env en el arranque — V0-1).
vi.mock("../api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
  signUp: vi.fn(),
  resendConfirmationEmail: vi.fn(),
}));

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<p>inicio</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function completarFormulario(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText("Nombre completo"), "Ada Lovelace");
  await user.type(screen.getByLabelText("Email"), "demo@farox.app");
  await user.type(screen.getByLabelText("Contraseña"), "secreto123");
}

// El consentimiento es OBLIGATORIO: sin marcar, el schema rompe el parse y
// no hay request. Los flujos exitosos lo marcan explícitamente.
async function aceptarPrivacidad(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("checkbox", { name: /Política de Privacidad/ }));
}

// Esperar el botón ANTES de tipear evita escribir en inputs de un formulario
// que aún no montó (lección #509 del patrón de B6/B7).
async function enviarRegistro(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await completarFormulario(user);
  await aceptarPrivacidad(user);
  await user.click(await screen.findByRole("button", { name: "Crear cuenta" }));
}

describe("RegisterPage (D1 · ruta pública /register)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: null, premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.signUp).mockResolvedValue({ needsConfirmation: true, error: null });
    vi.mocked(authApi.resendConfirmationEmail).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("renderiza los tres campos, el submit y el cross-link al login", () => {
    renderRegister();
    expect(screen.getByLabelText("Nombre completo")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "¿Ya tenés cuenta? Iniciá sesión" }),
    ).toHaveAttribute("href", "/login");
  });

  it("formulario vacío: errores inline y CERO requests", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("Ingresá tu nombre completo")).toBeInTheDocument();
    expect(screen.getByText("Ingresá tu email")).toBeInTheDocument();
    expect(screen.getByText("Ingresá tu contraseña")).toBeInTheDocument();
    expect(authApi.signUp).not.toHaveBeenCalled();
  });

  it("email inválido y contraseña corta: errores inline, tampoco llama a la api", async () => {
    const user = userEvent.setup();
    renderRegister();
    await user.type(screen.getByLabelText("Nombre completo"), "Ada Lovelace");
    await user.type(screen.getByLabelText("Email"), "no-es-email");
    await user.type(screen.getByLabelText("Contraseña"), "abc");
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("Ingresá un email válido")).toBeInTheDocument();
    expect(
      screen.getByText("La contraseña debe tener al menos 6 caracteres"),
    ).toBeInTheDocument();
    expect(authApi.signUp).not.toHaveBeenCalled();
  });

  it("éxito: pantalla de confirmación y signUp con email, password y full_name", async () => {
    const user = userEvent.setup();
    renderRegister();
    await enviarRegistro(user);

    expect(await screen.findByRole("heading", { name: "Revisá tu email" })).toBeInTheDocument();
    expect(
      screen.getByText(/Revisá tu email para confirmar tu cuenta/),
    ).toBeInTheDocument();
    // Datos en el ORDEN de la firma: (email, password, fullName, consent) —
    // el paso a options.data (full_name + consentimiento) se prueba en
    // api.test.ts; acá solo el contrato del call site.
    expect(authApi.signUp).toHaveBeenCalledWith("demo@farox.app", "secreto123", "Ada Lovelace", {
      accepted_privacy_at: expect.any(String),
      accepted_privacy_version: PRIVACY_VERSION,
    });
    expect(screen.queryByRole("button", { name: "Crear cuenta" })).not.toBeInTheDocument();
  });

  it("mientras envía: botón deshabilitado con estado 'Creando cuenta…'", async () => {
    let resolveSignUp!: (value: authApi.SignUpOutcome) => void;
    vi.mocked(authApi.signUp).mockReturnValue(
      new Promise<authApi.SignUpOutcome>((resolve) => {
        resolveSignUp = resolve;
      }),
    );
    const user = userEvent.setup();
    renderRegister();
    await enviarRegistro(user);

    expect(await screen.findByRole("button", { name: "Creando cuenta…" })).toBeDisabled();

    resolveSignUp({ needsConfirmation: true, error: null });
    expect(await screen.findByRole("heading", { name: "Revisá tu email" })).toBeInTheDocument();
  });

  it("reenviar email: llama a resendConfirmationEmail con el email y confirma", async () => {
    const user = userEvent.setup();
    renderRegister();
    await enviarRegistro(user);
    await screen.findByRole("heading", { name: "Revisá tu email" });

    await user.click(await screen.findByRole("button", { name: "Reenviar email" }));

    await waitFor(() =>
      expect(authApi.resendConfirmationEmail).toHaveBeenCalledWith("demo@farox.app"),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Email de confirmación reenviado. Revisá tu bandeja de entrada.",
    );
  });

  it("reenviar falla: Feedback de error propio (banner), sin texto crudo", async () => {
    vi.mocked(authApi.resendConfirmationEmail).mockResolvedValue({
      error: { message: "rate limited by server" },
    });
    const user = userEvent.setup();
    renderRegister();
    await enviarRegistro(user);
    await screen.findByRole("heading", { name: "Revisá tu email" });

    await user.click(await screen.findByRole("button", { name: "Reenviar email" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ocurrió un error inesperado. Intentá de nuevo.",
    );
    expect(screen.queryByText(/rate limited/)).not.toBeInTheDocument();
  });

  it("'User already registered': mensaje propio y no técnico, jamás el crudo", async () => {
    vi.mocked(authApi.signUp).mockResolvedValue({
      needsConfirmation: false,
      error: { message: "User already registered" },
    });
    const user = userEvent.setup();
    renderRegister();
    await enviarRegistro(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo crear la cuenta. Si ya tenés una, iniciá sesión con ese email.",
    );
    expect(screen.queryByText(/User already registered/)).not.toBeInTheDocument();
    // Sigo en el formulario: no hubo navegación de éxito.
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
  });

  it("error de red: mensaje de mapError (HARD-1), sin texto crudo", async () => {
    vi.mocked(authApi.signUp).mockResolvedValue({
      needsConfirmation: false,
      error: { message: "Failed to fetch" },
    });
    const user = userEvent.setup();
    renderRegister();
    await enviarRegistro(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar, revisá tu conexión.",
    );
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });

  it("sesión activa de entrada (confirmación OFF): redirige al home", async () => {
    vi.mocked(authApi.signUp).mockResolvedValue({ needsConfirmation: false, error: null });
    const user = userEvent.setup();
    renderRegister();
    await enviarRegistro(user);

    expect(await screen.findByText("inicio")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Revisá tu email" })).not.toBeInTheDocument();
    expect(authApi.resendConfirmationEmail).not.toHaveBeenCalled();
  });

  // ── Consentimiento de privacidad (requerido) ──────────────────────────────

  it("la casilla de privacidad existe y está SIN marcar por defecto", () => {
    renderRegister();
    expect(
      screen.getByRole("checkbox", { name: /Política de Privacidad/ }),
    ).not.toBeChecked();
  });

  it("campos válidos pero casilla SIN marcar: error inline y CERO llamadas a la api", async () => {
    const user = userEvent.setup();
    renderRegister();
    await completarFormulario(user);
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(
      await screen.findByText("Debés aceptar la Política de Privacidad para crear tu cuenta"),
    ).toBeInTheDocument();
    expect(authApi.signUp).not.toHaveBeenCalled();
  });

  it("casilla marcada: signUp recibe la metadata con fecha ISO y la versión de la política", async () => {
    const user = userEvent.setup();
    renderRegister();
    await enviarRegistro(user); // completarFormulario + aceptarPrivacidad
    await screen.findByRole("heading", { name: "Revisá tu email" });

    expect(authApi.signUp).toHaveBeenCalledTimes(1);
    const consent = vi.mocked(authApi.signUp).mock.calls[0][3];
    // ISO 8601 con 'Z' (UTC): Date.parse valida el formato completo.
    expect(consent.accepted_privacy_at).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(Number.isNaN(Date.parse(consent.accepted_privacy_at))).toBe(false);
    expect(consent.accepted_privacy_version).toBe(PRIVACY_VERSION);
  });

  it("el link de privacidad apunta a /privacidad y abre en pestaña nueva", () => {
    renderRegister();
    const link = screen.getByRole("link", { name: "Política de Privacidad" });
    expect(link).toHaveAttribute("href", "/privacidad");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
