import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as profileApi from "../api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { ProfilePage } from "./ProfilePage";

// Ambas capas api se mockean completas: cero red, cero supabase en los tests.
vi.mock("../api", () => ({
  fetchMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

function renderPerfil() {
  return render(
    <MemoryRouter initialEntries={["/profile"]}>
      <AuthProvider>
        <Routes>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/" element={<p>inicio</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("ProfilePage (§S2 fila /profile)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(profileApi.fetchMyProfile).mockResolvedValue({
      row: { full_name: "Ada Lovelace", phone_number: "555-1234", contact_preference: "whatsapp" },
      error: null,
    });
    vi.mocked(profileApi.updateMyProfile).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("guarda enviando SOLO las 3 columnas de perfil (§S2 profile-column-limit)", async () => {
    const user = userEvent.setup();
    renderPerfil();
    expect(await screen.findByDisplayValue("Ada Lovelace")).toBeInTheDocument();
    expect(profileApi.fetchMyProfile).toHaveBeenCalledWith("u1");

    await user.clear(screen.getByLabelText("Nombre completo"));
    await user.type(screen.getByLabelText("Nombre completo"), "Grace Hopper");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Perfil actualizado.")).toBeInTheDocument();
    expect(profileApi.updateMyProfile).toHaveBeenCalledTimes(1);
    const [userId, values] = vi.mocked(profileApi.updateMyProfile).mock.calls[0];
    expect(userId).toBe("u1");
    expect(Object.keys(values).sort()).toEqual([
      "contact_preference",
      "full_name",
      "phone_number",
    ]);
  });

  it("nombre vacío: error inline y CERO requests (PROD-3)", async () => {
    const user = userEvent.setup();
    renderPerfil();
    await screen.findByDisplayValue("Ada Lovelace");
    await user.clear(screen.getByLabelText("Nombre completo"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText("Ingresá tu nombre")).toBeInTheDocument();
    expect(profileApi.updateMyProfile).not.toHaveBeenCalled();
  });

  it("fallo al cargar la fila propia: mensaje amigable, sin crash (S7)", async () => {
    vi.mocked(profileApi.fetchMyProfile).mockResolvedValue({
      row: null,
      error: { message: "permission denied for table users" },
    });
    renderPerfil();
    expect(await screen.findByText("No se pudo cargar tu perfil.")).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
  });
});
