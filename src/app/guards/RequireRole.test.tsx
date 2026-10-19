import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RoleName } from "../../features/auth/types";
import * as authApi from "../../features/auth/api";
import { AuthProvider } from "../providers/AuthProvider";
import { RequireAuth } from "./RequireAuth";
import { RequireRole } from "./RequireRole";

vi.mock("../../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

// Probe de la pantalla protegida: si RequireRole deniega, este effect (y la
// query que dispararía) NUNCA corre — "denegar antes de cualquier query" (§S2).
const listUsers = vi.fn();

function UsersScreen() {
  useEffect(() => {
    listUsers();
  }, []);
  return <p>pantalla de usuarios</p>;
}

const ADMIN_ONLY: readonly RoleName[] = ["admin"];

function renderConRol(role: RoleName | null) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium: false });
  return render(
    <MemoryRouter initialEntries={["/users"]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<p>pantalla de login</p>} />
          <Route element={<RequireAuth />}>
            <Route
              path="/users"
              element={
                <RequireRole roles={ADMIN_ONLY}>
                  <UsersScreen />
                </RequireRole>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("RequireRole (§S2 denegación / V0-3 rol ausente)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "admin", premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("admin: entra a la pantalla", async () => {
    renderConRol("admin");
    expect(await screen.findByText("pantalla de usuarios")).toBeInTheDocument();
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it("operador: AccessDenied ANTES de cualquier query (§S2)", async () => {
    renderConRol("operador");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(screen.queryByText("pantalla de usuarios")).not.toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("distribuidor: denegado en /users", async () => {
    renderConRol("distribuidor");
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("sin rol (my_role() NULL): denegado sin crash (V0-3)", async () => {
    renderConRol(null);
    expect(await screen.findByText("Acceso denegado")).toBeInTheDocument();
    expect(listUsers).not.toHaveBeenCalled();
  });
});
