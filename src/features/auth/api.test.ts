import type { AuthError, Session, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabase } from "../../shared/lib/supabase/client";
import {
  confirmEmailConfirmationCode,
  establishRecoverySession,
  requestPasswordReset,
  resendConfirmationEmail,
  signUp,
  updatePassword,
} from "./api";

// Capa api contra el cliente supabase MOCKEADO (mismo aislamiento que el
// resto de la suite: el cliente real valida el env al importar, V0-1). Acá se
// prueba el CONTRATO exacto que viaja a Auth: metadata full_name (lee el
// trigger handle_new_user, 0004:336), type "signup" del reenvío y el canje
// PKCE del código de confirmación (D2).
vi.mock("../../shared/lib/supabase/client", () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      resend: vi.fn(),
      exchangeCodeForSession: vi.fn(),
      getSession: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
  },
}));

const signUpMock = vi.mocked(supabase.auth.signUp);
const resendMock = vi.mocked(supabase.auth.resend);
const exchangeMock = vi.mocked(supabase.auth.exchangeCodeForSession);
const authGetSessionMock = vi.mocked(supabase.auth.getSession);
const resetPasswordMock = vi.mocked(supabase.auth.resetPasswordForEmail);
const updateUserMock = vi.mocked(supabase.auth.updateUser);

// User mínimo para AuthTokenResponse (data exige user y session juntos, no
// mixtos — unión de auth-js) y para el getSession de dominio, que lee
// session.user.id (api.ts:34).
const FAKE_USER = { id: "u1" } as User;
// Session mínima: solo importa que NO es null para la rama "sin confirmación".
const FAKE_SESSION = { access_token: "token", user: FAKE_USER } as Session;
// AuthError mínimo: la capa api solo lee .message (AuthOperationError, api.ts).
const AUTH_ERROR = { message: "User already registered" } as AuthError;

describe("auth api · signUp (D1 · única vía de registro)", () => {
  // Consentimiento de privacidad del registro: el test usa timestamp fijo
  // (la página lo estampa en tiempo real — ver RegisterPage.test.tsx).
  const CONSENT = {
    accepted_privacy_at: "2026-10-20T15:00:00.000Z",
    accepted_privacy_version: "1.0",
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envía full_name y el consentimiento de privacidad en options.data", async () => {
    signUpMock.mockResolvedValue({ data: { user: null, session: null }, error: null });

    const result = await signUp("demo@farox.app", "secreto123", "Ada Lovelace", CONSENT);

    // full_name lo lee el trigger handle_new_user (0004:336); el
    // consentimiento queda en user_metadata como prueba de la aceptación
    // (fecha ISO + versión de la política aceptada).
    expect(signUpMock).toHaveBeenCalledWith({
      email: "demo@farox.app",
      password: "secreto123",
      options: {
        data: {
          full_name: "Ada Lovelace",
          accepted_privacy_at: "2026-10-20T15:00:00.000Z",
          accepted_privacy_version: "1.0",
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    // Sin sesión ⇒ Confirm email activo (D44): el flujo es "confirmar", no login.
    expect(result).toEqual({ needsConfirmation: true, error: null });
  });

  it("sesión devuelta de entrada (confirmación OFF): needsConfirmation = false", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: FAKE_SESSION },
      error: null,
    });

    const result = await signUp("demo@farox.app", "secreto123", "Ada Lovelace", CONSENT);

    expect(result).toEqual({ needsConfirmation: false, error: null });
  });

  it("error de Auth: se propaga tal cual (con { message } solo, api.ts:23-25)", async () => {
    signUpMock.mockResolvedValue({
      data: { user: null, session: null },
      error: AUTH_ERROR,
    });

    const result = await signUp("demo@farox.app", "secreto123", "Ada Lovelace", CONSENT);

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

describe("auth api · confirmEmailConfirmationCode (D2 · canje PKCE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom: history.replaceState fija window.location.search que lee el helper.
    window.history.replaceState({}, "", "/auth/callback");
  });
  it("leyó el code de la URL y lo canjeó con exchangeCodeForSession", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=abc123");
    exchangeMock.mockResolvedValue({
      data: { user: FAKE_USER, session: FAKE_SESSION },
      error: null,
    });

    const outcome = await confirmEmailConfirmationCode();

    expect(exchangeMock).toHaveBeenCalledWith("abc123");
    expect(outcome).toEqual({ status: "ok" });
  });

  it("sin code y sin sesión: missing-code sin intentar el canje", async () => {
    authGetSessionMock.mockResolvedValue({ data: { session: null }, error: null } as never);
    const outcome = await confirmEmailConfirmationCode();

    expect(outcome).toEqual({ status: "missing-code" });
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("A0.2: sin code pero con sesión ya creada (flujo implícito): ok", async () => {
    authGetSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null } as never);
    const outcome = await confirmEmailConfirmationCode();

    expect(outcome).toEqual({ status: "ok" });
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it("código expirado/inválido y sin sesión: status error con el error de Auth", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=viejo");
    const authError = { message: "oauth code has expired" } as AuthError;
    exchangeMock.mockResolvedValue({ data: { user: null, session: null }, error: authError });
    authGetSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    const outcome = await confirmEmailConfirmationCode();

    expect(outcome).toEqual({ status: "error", error: authError });
  });

  it("el canje explícito falla pero YA hay sesión (auto-canje del cliente o doble montaje): status ok", async () => {
    window.history.replaceState({}, "", "/auth/callback?code=abc123");
    exchangeMock.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "code already redeemed" } as AuthError,
    });
    authGetSessionMock.mockResolvedValue({ data: { session: FAKE_SESSION }, error: null });

    const outcome = await confirmEmailConfirmationCode();

    expect(outcome).toEqual({ status: "ok" });
  });
});

describe("auth api · recuperación de contraseña", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/restablecer");
  });

  it("pide el email con redirectTo a /restablecer", async () => {
    resetPasswordMock.mockResolvedValue({ data: {}, error: null });

    const result = await requestPasswordReset("demo@farox.app");

    expect(resetPasswordMock).toHaveBeenCalledWith("demo@farox.app", {
      redirectTo: `${window.location.origin}/restablecer`,
    });
    expect(result).toEqual({ error: null });
  });

  it("propaga el error del pedido con { message }", async () => {
    const error = { message: "For security purposes, you can only request this after 60 seconds" } as AuthError;
    resetPasswordMock.mockResolvedValue({ data: null, error });

    const result = await requestPasswordReset("demo@farox.app");

    expect(result.error).toBe(error);
  });

  it("cambia la contraseña con updateUser({ password })", async () => {
    updateUserMock.mockResolvedValue({ data: { user: FAKE_USER }, error: null });

    const result = await updatePassword("nueva123");

    expect(updateUserMock).toHaveBeenCalledWith({ password: "nueva123" });
    expect(result).toEqual({ error: null });
  });

  it("establece la sesión de recuperación canjeando el code (PKCE)", async () => {
    window.history.replaceState({}, "", "/restablecer?code=rec123");
    exchangeMock.mockResolvedValue({
      data: { user: FAKE_USER, session: FAKE_SESSION },
      error: null,
    });

    const outcome = await establishRecoverySession();

    expect(exchangeMock).toHaveBeenCalledWith("rec123");
    expect(outcome).toEqual({ status: "ready" });
  });

  it("sin code y sin sesión: missing", async () => {
    authGetSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    const outcome = await establishRecoverySession();

    expect(outcome).toEqual({ status: "missing" });
  });

  it("code inválido y sin sesión: error de Auth", async () => {
    window.history.replaceState({}, "", "/restablecer?code=viejo");
    const authError = { message: "oauth code has expired" } as AuthError;
    exchangeMock.mockResolvedValue({ data: { user: null, session: null }, error: authError });
    authGetSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    const outcome = await establishRecoverySession();

    expect(outcome).toEqual({ status: "error", error: authError });
  });
});
