import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as authApi from "../../features/auth/api";
import type { AuthSessionListener } from "../../features/auth/api";
import type { Privileges } from "../../features/auth/types";
import { AuthProvider, useAuth } from "./AuthProvider";

// La capa api se mockea COMPLETA: el cliente supabase (con su validación de
// env a nivel de módulo) jamás se carga en un test.
vi.mock("../../features/auth/api", () => ({
  getSession: vi.fn(),
  subscribeToAuthChanges: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  fetchPrivileges: vi.fn(),
}));

const SESSION_U1 = { userId: "u1", email: "demo@farox.app" };
const SESSION_U2 = { userId: "u2", email: "otra@farox.app" };

// Historial de `status` en CADA render: permite detectar el flip destructivo
// a "loading" (el bug de "la página se recarga al cambiar de pestaña": el
// SDK re-emite SIGNED_IN en cada visibilitychange, RequireAuth desmontaba
// todo el Outlet y OnboardingGate volvía a "Cargando tu perfil…").
const statusLog: string[] = [];
// Contador de mounts del contenido protegido: un mount estable = nada se
// desmontó.
let mounted = 0;
let latestListener: AuthSessionListener | null = null;

function Probe() {
  const { status, userId, role } = useAuth();
  statusLog.push(status);
  useEffect(() => {
    mounted += 1;
    return () => {
      mounted -= 1;
    };
  }, []);
  if (status !== "authenticated") {
    return <p data-testid="status">{status}</p>;
  }
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{userId}</p>
      <p data-testid="role">{role ?? "sin rol"}</p>
      <p>contenido de la app</p>
    </div>
  );
}

describe("AuthProvider (SIGNED_IN/USER_UPDATED del mismo usuario ⇒ no destructivo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusLog.length = 0;
    mounted = 0;
    latestListener = null;
    vi.mocked(authApi.subscribeToAuthChanges).mockImplementation((listener) => {
      latestListener = listener;
      return () => {};
    });
    vi.mocked(authApi.getSession).mockResolvedValue(SESSION_U1);
    vi.mocked(authApi.fetchPrivileges).mockResolvedValue({ role: "operador", premium: false });
    vi.mocked(authApi.signOut).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("SIGNED_IN/USER_UPDATED con el MISMO userId: revalida privilegios SIN volver a 'loading' ni desmontar", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText("contenido de la app")).toBeInTheDocument();
    expect(authApi.fetchPrivileges).toHaveBeenCalledTimes(1);
    const rendersAfterBoot = statusLog.length;
    const mountsAfterBoot = mounted;

    await act(async () => {
      // El escenario real del bug: el SDK notifica la MISMA sesión vigente en
      // cada visibilitychange (GoTrueClient.js:4163-4167).
      latestListener?.("SIGNED_IN", SESSION_U1);
      latestListener?.("USER_UPDATED", SESSION_U1);
    });

    // Privilegios revalidados por cada evento (mismo camino que TOKEN_REFRESHED)…
    await waitFor(() => expect(authApi.fetchPrivileges).toHaveBeenCalledTimes(3));
    // …y NI un solo render en "loading" después del arranque: el contenido
    // protegido jamás se desmontó.
    expect(statusLog.slice(rendersAfterBoot)).not.toContain("loading");
    expect(mounted).toBe(mountsAfterBoot);
    expect(screen.getByText("contenido de la app")).toBeInTheDocument();
    expect(screen.getByTestId("user")).toHaveTextContent("u1");
  });

  it("SIGNED_IN con un userId DISTINTO: cambio de cuenta real ⇒ camino destructivo (loading + nuevo usuario)", async () => {
    // Los privilegios del usuario NUEVO quedan pendientes a propósito: si
    // resolvieran en el mismo tick que el evento, React batchearía el flip a
    // "loading" y el cambio de cuenta sería indistinguible de un refresh.
    let resolveSwitch: ((value: Privileges) => void) | undefined;
    vi.mocked(authApi.fetchPrivileges)
      .mockResolvedValueOnce({ role: "operador", premium: false })
      .mockReturnValueOnce(
        new Promise<Privileges>((resolve) => {
          resolveSwitch = resolve;
        }),
      );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    expect(await screen.findByText("contenido de la app")).toBeInTheDocument();
    const rendersBeforeSwitch = statusLog.length;

    await act(async () => {
      latestListener?.("SIGNED_IN", SESSION_U2);
    });

    // applySession destructivo: pasa por "loading" (RequireAuth puede
    // mostrar la espera) y termina con el privilegio del usuario nuevo.
    expect(statusLog.slice(rendersBeforeSwitch)).toContain("loading");

    await act(async () => {
      resolveSwitch?.({ role: "operador", premium: false });
    });

    expect(await screen.findByTestId("user")).toHaveTextContent("u2");
    expect(authApi.fetchPrivileges).toHaveBeenCalledTimes(2);
  });

  it("SIGNED_OUT sigue siendo destructivo: vuelve a anon", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(await screen.findByText("contenido de la app")).toBeInTheDocument();

    await act(async () => {
      latestListener?.("SIGNED_OUT", null);
    });

    expect(screen.getByTestId("status")).toHaveTextContent("anon");
    expect(screen.queryByText("contenido de la app")).not.toBeInTheDocument();
  });
});
