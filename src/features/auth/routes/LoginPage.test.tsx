import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { LoginPage } from "./LoginPage";

vi.mock("../api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/inicio" element={<p>inicio</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage (§S2 fila /login)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getSession).mockResolvedValue(null);
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: null, premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(authApi.signInWithPassword).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("formulario vacío: errores inline y CERO requests", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Ingresá tu email")).toBeInTheDocument();
    expect(screen.getByText("Ingresá tu contraseña")).toBeInTheDocument();
    expect(authApi.signInWithPassword).not.toHaveBeenCalled();
  });

  it("email inválido: error inline y tampoco llama a la API", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "no-es-email");
    await user.type(screen.getByLabelText("Contraseña"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Ingresá un email válido")).toBeInTheDocument();
    expect(authApi.signInWithPassword).not.toHaveBeenCalled();
  });

  it("credenciales inválidas: mensaje amigable, sin texto crudo del backend", async () => {
    vi.mocked(authApi.signInWithPassword).mockResolvedValue({
      error: { message: "Invalid login credentials" },
    });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "demo@farox.app");
    await user.type(screen.getByLabelText("Contraseña"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    expect(await screen.findByText("Email o contraseña incorrectos.")).toBeInTheDocument();
    expect(screen.queryByText(/Invalid login credentials/)).not.toBeInTheDocument();
  });

  it("cross-link al registro (D1): Link a la ruta pública /register", () => {
    renderLogin();
    expect(
      screen.getByRole("link", { name: "¿No tenés cuenta? Registrate" }),
    ).toHaveAttribute("href", "/register");
  });

  it("enlace de recuperación: Link a la ruta pública /recuperar", () => {
    renderLogin();
    expect(screen.getByRole("link", { name: "¿Olvidaste tu contraseña?" })).toHaveAttribute(
      "href",
      "/recuperar",
    );
  });

  it("email sin confirmar: pide confirmar el email antes de iniciar sesión", async () => {
    vi.mocked(authApi.signInWithPassword).mockResolvedValue({
      error: { message: "Email not confirmed" },
    });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "demo@farox.app");
    await user.type(screen.getByLabelText("Contraseña"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));

    expect(
      await screen.findByText(
        "Confirmá tu email antes de iniciar sesión. Revisá tu bandeja de entrada y abrí el link de verificación.",
      ),
    ).toBeInTheDocument();
  });

  it("permite mostrar y ocultar la contraseña sin alterar lo tipeado", async () => {
    const user = userEvent.setup();
    renderLogin();
    const password = screen.getByLabelText("Contraseña");
    await user.type(password, "secreto123");
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("secreto123");

    await user.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("datos válidos: llama a signInWithPassword con el formulario", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByLabelText("Email"), "demo@farox.app");
    await user.type(screen.getByLabelText("Contraseña"), "secreto123");
    await user.click(screen.getByRole("button", { name: "Ingresar" }));
    await waitFor(() =>
      expect(authApi.signInWithPassword).toHaveBeenCalledWith({
        email: "demo@farox.app",
        password: "secreto123",
      }),
    );
  });
});
