import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { ResetPasswordPage } from "./ResetPasswordPage";

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

function renderReset() {
  return render(
    <MemoryRouter initialEntries={["/restablecer"]}>
      <AuthProvider>
        <Routes>
          <Route path="/restablecer" element={<ResetPasswordPage />} />
          <Route path="/recuperar" element={<p>recuperar</p>} />
          <Route path="/inicio" element={<p>inicio</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ResetPasswordPage · elegir la nueva contraseña", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: null, premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.establishRecoverySession).mockResolvedValue({ status: "ready" });
    vi.mocked(authApi.updatePassword).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("sin sesión de recuperación: link inválido y salida a /recuperar", async () => {
    vi.mocked(authApi.establishRecoverySession).mockResolvedValue({ status: "missing" });
    renderReset();

    expect(await screen.findByText("El link no es válido")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedir un link nuevo" })).toHaveAttribute(
      "href",
      "/recuperar",
    );
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
  });

  it("con sesión: muestra el formulario de nueva contraseña", async () => {
    renderReset();

    expect(await screen.findByLabelText("Nueva contraseña")).toBeInTheDocument();
    expect(screen.getByLabelText("Repetir contraseña")).toBeInTheDocument();
  });

  it("contraseñas distintas: error inline y CERO requests", async () => {
    const user = userEvent.setup();
    renderReset();
    await user.type(await screen.findByLabelText("Nueva contraseña"), "nueva123");
    await user.type(screen.getByLabelText("Repetir contraseña"), "otra123");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByText("Las contraseñas no coinciden")).toBeInTheDocument();
    expect(authApi.updatePassword).not.toHaveBeenCalled();
  });

  it("contraseña corta: error inline y CERO requests", async () => {
    const user = userEvent.setup();
    renderReset();
    await user.type(await screen.findByLabelText("Nueva contraseña"), "corta");
    await user.type(screen.getByLabelText("Repetir contraseña"), "corta");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(
      await screen.findByText("La contraseña debe tener al menos 6 caracteres"),
    ).toBeInTheDocument();
    expect(authApi.updatePassword).not.toHaveBeenCalled();
  });

  it("contraseña válida: actualiza y muestra la salida al inicio", async () => {
    const user = userEvent.setup();
    renderReset();
    await user.type(await screen.findByLabelText("Nueva contraseña"), "nueva123");
    await user.type(screen.getByLabelText("Repetir contraseña"), "nueva123");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(await screen.findByText("Contraseña actualizada")).toBeInTheDocument();
    expect(authApi.updatePassword).toHaveBeenCalledWith("nueva123");
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute(
      "href",
      "/inicio",
    );
  });

  it("weak_password: mensaje propio, sin texto crudo", async () => {
    vi.mocked(authApi.updatePassword).mockResolvedValue({
      error: { message: "weak_password: Password should be at least 6 characters." },
    });
    const user = userEvent.setup();
    renderReset();
    await user.type(await screen.findByLabelText("Nueva contraseña"), "nueva123");
    await user.type(screen.getByLabelText("Repetir contraseña"), "nueva123");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(
      await screen.findByText("La contraseña no cumple los requisitos mínimos de seguridad."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/weak_password/)).not.toBeInTheDocument();
  });

  it("same_password de GoTrue: pide una contraseña distinta, no la de requisitos", async () => {
    vi.mocked(authApi.updatePassword).mockResolvedValue({
      error: { message: "New password should be different from the old password." },
    });
    const user = userEvent.setup();
    renderReset();
    await user.type(await screen.findByLabelText("Nueva contraseña"), "nueva123");
    await user.type(screen.getByLabelText("Repetir contraseña"), "nueva123");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(
      await screen.findByText("La nueva contraseña debe ser distinta de la anterior."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("La contraseña no cumple los requisitos mínimos de seguridad."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/New password should/)).not.toBeInTheDocument();
  });

  it("sesión de recuperación expirada: pide un link nuevo", async () => {
    vi.mocked(authApi.updatePassword).mockResolvedValue({
      error: { message: "Auth session missing!" },
    });
    const user = userEvent.setup();
    renderReset();
    await user.type(await screen.findByLabelText("Nueva contraseña"), "nueva123");
    await user.type(screen.getByLabelText("Repetir contraseña"), "nueva123");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(
      await screen.findByText("Tu sesión de recuperación expiró. Pedí un link nuevo."),
    ).toBeInTheDocument();
  });
});
