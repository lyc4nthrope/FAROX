import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { CallbackPage } from "./CallbackPage";

// D2: /auth/callback es pública — el harness monta SOLO CallbackPage (sin
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
  confirmEmailConfirmationCode: vi.fn(),
}));

function renderCallback() {
  return render(
    <MemoryRouter initialEntries={["/auth/callback?code=abc123"]}>
      <AuthProvider>
        <Routes>
          <Route path="/auth/callback" element={<CallbackPage />} />
          <Route path="/inicio" element={<p>inicio</p>} />
          <Route path="/login" element={<p>pantalla-login</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("CallbackPage (D2 · ruta pública /auth/callback)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: null, premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.confirmEmailConfirmationCode).mockResolvedValue({ status: "ok" });
    // La página strippea el code con replaceState sobre window.location real
    // (jsdom) — se limpia acá para no filtrar entre tests.
    window.history.replaceState({}, "", "/auth/callback?code=abc123");
  });

  afterEach(() => {
    cleanup();
  });

  it("mientras canjea el código: pantalla de procesamiento (sin hang)", async () => {
    let resolveExchange!: (value: authApi.ConfirmEmailOutcome) => void;
    vi.mocked(authApi.confirmEmailConfirmationCode).mockReturnValue(
      new Promise<authApi.ConfirmEmailOutcome>((resolve) => {
        resolveExchange = resolve;
      }),
    );
    renderCallback();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Un momento mientras activamos tu cuenta.",
    );
    expect(screen.queryByRole("link", { name: "Iniciá sesión" })).not.toBeInTheDocument();

    resolveExchange({ status: "ok" });
    expect(await screen.findByText("inicio")).toBeInTheDocument();
  });

  it("éxito: canjea, strippea el code de la URL y navega al home (seam #538 §8)", async () => {
    renderCallback();

    expect(await screen.findByText("inicio")).toBeInTheDocument();
    expect(authApi.confirmEmailConfirmationCode).toHaveBeenCalledTimes(1);
    // El código muerto NO queda en la URL (replaceState, sin recarga).
    await waitFor(() => expect(window.location.search).toBe(""));
    expect(window.location.pathname).toBe("/auth/callback");
  });

  it("canje fallido: mensaje mapeado + link al login, jamás el texto crudo", async () => {
    vi.mocked(authApi.confirmEmailConfirmationCode).mockResolvedValue({
      status: "error",
      error: { message: "oauth code has expired" },
    });
    renderCallback();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El link de confirmación expiró. Iniciá sesión y pedí uno nuevo.",
    );
    expect(screen.queryByText(/oauth code/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Iniciá sesión" }),
    ).toHaveAttribute("href", "/login");
  });

  it("code ya usado (sin sesión): mensaje propio de link duplicado", async () => {
    vi.mocked(authApi.confirmEmailConfirmationCode).mockResolvedValue({
      status: "error",
      error: { message: "code already redeemed" },
    });
    renderCallback();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este link de confirmación ya fue usado. Iniciá sesión para continuar.",
    );
  });

  it("sin code en la URL: rama de error con salida al login", async () => {
    vi.mocked(authApi.confirmEmailConfirmationCode).mockResolvedValue({
      status: "missing-code",
    });
    renderCallback();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El link de confirmación es inválido o está incompleto. Pedí uno nuevo desde el login.",
    );
    expect(screen.getByRole("link", { name: "Iniciá sesión" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("error de red: mensaje de mapError (HARD-1), sin texto crudo", async () => {
    vi.mocked(authApi.confirmEmailConfirmationCode).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    renderCallback();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo conectar, revisá tu conexión.",
    );
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
  });
});
