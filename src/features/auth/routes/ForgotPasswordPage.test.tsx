import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { ForgotPasswordPage } from "./ForgotPasswordPage";

vi.mock("../api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
  requestPasswordReset: vi.fn(),
  updatePassword: vi.fn(),
  establishRecoverySession: vi.fn(),
}));

function renderForgot() {
  return render(
    <MemoryRouter initialEntries={["/recuperar"]}>
      <AuthProvider>
        <Routes>
          <Route path="/recuperar" element={<ForgotPasswordPage />} />
          <Route path="/login" element={<p>login</p>} />
          <Route path="/inicio" element={<p>inicio</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ForgotPasswordPage · pedir el link por email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: null, premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("formulario vacío: error inline y CERO requests", async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    expect(await screen.findByText("Ingresá tu email")).toBeInTheDocument();
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("email inválido: error inline y CERO requests", async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText("Email"), "no-es-email");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    expect(await screen.findByText("Ingresá un email válido")).toBeInTheDocument();
    expect(authApi.requestPasswordReset).not.toHaveBeenCalled();
  });

  it("email válido: pide el link y muestra un mensaje genérico", async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText("Email"), "demo@farox.app");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    expect(await screen.findByText(/Si el email está registrado/i)).toBeInTheDocument();
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith("demo@farox.app");
    expect(screen.queryByText(/demo@farox\.app/)).not.toBeInTheDocument();
  });

  it("rate limit: mensaje accionable, sin texto crudo del backend", async () => {
    vi.mocked(authApi.requestPasswordReset).mockResolvedValue({
      error: {
        message: "For security purposes, you can only request this after 60 seconds.",
      },
    });
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText("Email"), "demo@farox.app");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    expect(
      await screen.findByText(
        "Pediste varios emails seguidos. Esperá unos minutos y volvé a intentar.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/For security purposes/)).not.toBeInTheDocument();
  });

  it("tiene salida al login", () => {
    renderForgot();
    expect(screen.getByRole("link", { name: "Volver al login" })).toHaveAttribute(
      "href",
      "/login",
    );
  });
});
