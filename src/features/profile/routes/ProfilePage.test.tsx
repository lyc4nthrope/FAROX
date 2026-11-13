import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import * as profileApi from "../api";
import * as premiumApi from "../../premium/api";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { ProfilePage } from "./ProfilePage";

// Ambas capas api se mockean completas: cero red, cero supabase en los tests.
vi.mock("../api", () => ({
  fetchMyProfile: vi.fn(),
  updateMyProfile: vi.fn(),
  startPhoneVerification: vi.fn(),
  setMyMargin: vi.fn(),
}));
vi.mock("../../premium/api", () => ({
  fetchMyPremiumStatus: vi.fn(),
  fetchMySubscription: vi.fn(),
  cancelSubscription: vi.fn(),
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
      row: {
        full_name: "Ada Lovelace",
        phone_number: "555-1234",
        contact_preference: "whatsapp",
        phone_verified_at: null,
        default_margin_pct: null,
      },
      error: null,
    });
    vi.mocked(profileApi.updateMyProfile).mockResolvedValue({ error: null });
    vi.mocked(profileApi.setMyMargin).mockResolvedValue({ error: null });
    vi.mocked(profileApi.startPhoneVerification).mockResolvedValue({
      data: null,
      error: { message: "phone_verification: sin respuesta" },
    });
    vi.mocked(premiumApi.fetchMyPremiumStatus).mockResolvedValue({
      data: {
        premium: false,
        premiumUntil: null,
        premiumGraceUntil: null,
        graceActive: false,
        needsStoreChoice: false,
        activeOwnedStores: 1,
      },
      error: null,
    });
    vi.mocked(premiumApi.fetchMySubscription).mockResolvedValue({ data: null, error: null });
    vi.mocked(premiumApi.cancelSubscription).mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("muestra el plan actual en el perfil (0032)", async () => {
    renderPerfil();

    expect(await screen.findByText("Plan gratuito")).toBeInTheDocument();
    expect(screen.getByText("Gratis")).toBeInTheDocument();
  });

  it("distribuidor: ofrece vincular tienda desde Perfil", async () => {
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "distribuidor", premium: false });

    renderPerfil();

    expect(await screen.findByRole("link", { name: "Vincular tienda" })).toHaveAttribute(
      "href",
      "/vincular",
    );
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
    expect(Object.keys(values).sort()).toEqual(["contact_preference", "full_name", "phone_number"]);
  });

  it("el margen de ganancia se guarda por RPC y muestra el ejemplo (0045)", async () => {
    const user = userEvent.setup();
    renderPerfil();

    const input = await screen.findByLabelText("Ganancia sobre el costo (%)");
    await user.clear(input);
    await user.type(input, "50");

    expect(screen.getByText(/vendés a/)).toHaveTextContent(/15\.000/);

    await user.click(screen.getByRole("button", { name: "Guardar margen" }));

    expect(profileApi.setMyMargin).toHaveBeenCalledWith(50);
    expect(await screen.findByText("Margen guardado: 50%.")).toBeInTheDocument();
    // El margen NO viaja en el UPDATE de perfil (§S2 profile-column-limit).
    expect(profileApi.updateMyProfile).not.toHaveBeenCalled();
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

  it("teléfono sin verificar: ofrece verificar (0042)", async () => {
    renderPerfil();
    expect(
      await screen.findByRole("button", { name: "Verificar este número" }),
    ).toBeInTheDocument();
  });

  it("genera el código y lo muestra para mandar por WhatsApp (0042)", async () => {
    const user = userEvent.setup();
    vi.mocked(profileApi.startPhoneVerification).mockResolvedValue({
      data: {
        code: "A1B2C3",
        phone_e164: "+573002223333",
        expires_at: "2026-11-05T12:10:00Z",
      },
      error: null,
    });
    renderPerfil();

    await user.click(await screen.findByRole("button", { name: "Verificar este número" }));

    expect(profileApi.startPhoneVerification).toHaveBeenCalledWith("555-1234");
    expect(await screen.findByText(/FAROX\s*A1B2C3/)).toBeInTheDocument();
  });

  it("teléfono verificado: muestra el estado (0042)", async () => {
    vi.mocked(profileApi.fetchMyProfile).mockResolvedValue({
      row: {
        full_name: "Ada Lovelace",
        phone_number: "+573002223333",
        contact_preference: "whatsapp",
        phone_verified_at: "2026-11-05T12:00:00Z",
        default_margin_pct: null,
      },
      error: null,
    });
    renderPerfil();
    expect(await screen.findByText("✅ Teléfono verificado")).toBeInTheDocument();
  });

  it("número ya verificado en otra cuenta: mensaje amigable (0042)", async () => {
    const user = userEvent.setup();
    vi.mocked(profileApi.startPhoneVerification).mockResolvedValue({
      data: null,
      error: {
        message: "phone_verification: ese teléfono ya está verificado en otra cuenta",
      },
    });
    renderPerfil();

    await user.click(await screen.findByRole("button", { name: "Verificar este número" }));

    expect(
      await screen.findByText("Ese número ya está verificado en otra cuenta."),
    ).toBeInTheDocument();
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
