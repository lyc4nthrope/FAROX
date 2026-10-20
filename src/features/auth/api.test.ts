import type { AuthError, Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import { resendConfirmationEmail, signUp } from "./api";

// Capa api contra el cliente supabase MOCKEADO (mismo aislamiento que el
// resto de la suite: el cliente real valida el env al importar, V0-1). Acá se
// prueba el CONTRATO exacto que viaja a Auth: metadata full_name (lee el
// trigger handle_new_user, 0004:336) y type "signup" del reenvío.
vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      resend: vi.fn(),
    },
  },
}));

const signUpMock = vi.mocked(supabase.auth.signUp);
const resendMock = vi.mocked(supabase.auth.resend);

// Session mínima: solo importa que NO es null para la rama "sin confirmación".
const FAKE_SESSION = { access_token: "token" } as Session;
// AuthError mínimo: la capa api solo lee .message (AuthOperationError, api.ts).
const AUTH_ERROR = { message: "User already registered" } as AuthError;

describe("auth api · signUp (D1 · única vía de registro)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envía full_name en options.data — es lo que lee el trigger 0004:336", async () => {
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: null });

    const result = await signUp("demo@farox.app", "secreto123", "Ada Lovelace");

    expect(signUpMock).toHaveBeenCalledWith({
      email: "demo@farox.app",
      password: "secreto123",
      options: { data: { full_name: "Ada Lovelace" } },
    });
    // Sin sesión ⇒ Confirm email activo (D44): el flujo es "confirmar", no login.
    expect(result).toEqual({ needsConfirmation: true, error: null });
  });

  it("sesión devuelta de entrada (confirmación OFF): needsConfirmation = false", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: FAKE_SESSION },
      error: null,
    });

    const result = await signUp("demo@farox.app", "secreto123", "Ada Lovelace");

    expect(result).toEqual({ needsConfirmation: false, error: null });
  });

  it("error de Auth: se propaga tal cual (con { message } solo, api.ts:23-25)", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: null },
      error: AUTH_ERROR,
    });

    const result = await signUp("demo@farox.app", "secreto123", "Ada Lovelace");

    expect(result.error).toBe(AUTH_ERROR);
    expect(result.needsConfirmation).toBe(false);
  });
});

describe("auth api · resendConfirmationEmail (D1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reenvía con type: 'signup' y el email registrado", async () => {
    resendMock.mockResolvedValue({ data: { user: null, session: null }, error: null });

    const result = await resendConfirmationEmail("demo@farox.app");

    expect(resendMock).toHaveBeenCalledWith({ type: "signup", email: "demo@farox.app" });
    expect(result).toEqual({ error: null });
  });

  it("error del reenvío: se propaga con { message }", async () => {
    const error = { message: "rate limit" } as AuthError;
    resendMock.mockResolvedValue({ data: { user: null, session: null }, error });

    const result = await resendConfirmationEmail("demo@farox.app");

    expect(result.error).toBe(error);
  });
});
