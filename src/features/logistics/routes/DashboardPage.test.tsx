import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../auth/api";
import type { RoleName } from "../../auth/types";
import { supabase } from "../../../shared/lib/supabase/client";
import { AuthProvider } from "../../../app/providers/AuthProvider";
import { DashboardPage } from "./DashboardPage";

vi.mock("../../../shared/lib/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));
vi.mock("../../auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const ROWS = [
  {
    day: "2026-11-01",
    distributor_id: 1,
    entries_count: 2,
    exits_count: 1,
    entries_value: 100,
    exits_value: 50,
  },
  {
    day: "2026-11-02",
    distributor_id: 1,
    entries_count: 1,
    exits_count: 0,
    entries_value: 10,
    exits_value: 0,
  },
];

function renderPage(role: RoleName, premium: boolean) {
  vi.mocked(authApi.getSession).mockResolvedValue({ userId: "u1", email: "demo@farox.app" });
  vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role, premium });
  return render(
    <MemoryRouter>
      <AuthProvider>
        <DashboardPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("DashboardPage · alcance del distribuidor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.subscribeToAuthChanges).mockReturnValue(() => {});
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: ROWS, error: null } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it("muestra su propia operación y no el desglose por distribuidor", async () => {
    renderPage("distribuidor", true);

    // «Días» solo existe en la rama Premium del distribuidor: esperar a que
    // resuelvan los privilegios evita asertar sobre el primer render.
    expect(await screen.findByText("Días")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.queryByText("Distribuidores")).not.toBeInTheDocument();
    expect(screen.queryByText("Por distribuidor")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Distribuidor" })).not.toBeInTheDocument();
  });
});
