import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  fetchPrivileges,
  getSession,
  signOut as signOutRequest,
  subscribeToAuthChanges,
} from "../../features/auth/api";
import type { CurrentSession } from "../../features/auth/api";
import type { Privileges, RoleName } from "../../features/auth/types";

export type AuthStatus = "loading" | "anon" | "authenticated";

export interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  email: string | null;
  role: RoleName | null;
  premium: boolean;
  // B4 lo usará al mutar la propia fila de un admin (D2: invalidar tras
  // update_user_role/set_user_active cuando la víctima soy yo).
  refreshPrivileges: () => Promise<void>;
  signOut: () => Promise<void>;
}

interface AuthState extends Privileges {
  status: AuthStatus;
  userId: string | null;
  email: string | null;
}

const INITIAL_STATE: AuthState = {
  status: "loading",
  userId: null,
  email: null,
  role: null,
  premium: false,
};
const ANON_STATE: AuthState = {
  status: "anon",
  userId: null,
  email: null,
  role: null,
  premium: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Rol/premium en MEMORIA, leídos de la DB (my_role/is_premium) — D2: el JWT,
// user_metadata, app_metadata y localStorage NUNCA son autoridad (idea:137).
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(INITIAL_STATE);
  const currentUserIdRef = useRef<string | null>(null);

  // Aplica una sesión: deja el estado en "loading" y resuelve los privilegios
  // contra la DB. El ref protege contra respuestas viejas (cambio de sesión
  // mientras el rpc estaba en vuelo).
  const applySession = useCallback(
    async (session: CurrentSession | null): Promise<void> => {
      if (session === null) {
        currentUserIdRef.current = null;
        setState(ANON_STATE);
        return;
      }
      currentUserIdRef.current = session.userId;
      setState({
        status: "loading",
        userId: session.userId,
        email: session.email,
        role: null,
        premium: false,
      });
      const privileges = await fetchPrivileges();
      if (currentUserIdRef.current !== session.userId) return;
      setState({
        status: "authenticated",
        userId: session.userId,
        email: session.email,
        role: privileges.role,
        premium: privileges.premium,
      });
    },
    [],
  );

  // Revalida privilegios de la sesión vigente SIN vaciar el estado (token
  // refresh, refocus de pestaña, auto-mutación de admin — D2).
  const refreshPrivileges = useCallback(async (): Promise<void> => {
    const userId = currentUserIdRef.current;
    if (userId === null) return;
    const privileges = await fetchPrivileges();
    if (currentUserIdRef.current !== userId) return;
    setState((previous) =>
      previous.userId === userId
        ? { ...previous, role: privileges.role, premium: privileges.premium }
        : previous,
    );
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await signOutRequest();
    } finally {
      currentUserIdRef.current = null;
      setState(ANON_STATE);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Arranque: la restauración de sesión sale de getSession(). INITIAL_SESSION
    // queda ignorado abajo para no duplicar la corrida de privilegios.
    void (async () => {
      try {
        const session = await getSession();
        if (!cancelled) await applySession(session);
      } catch {
        if (!cancelled) {
          currentUserIdRef.current = null;
          setState(ANON_STATE);
        }
      }
    })();

    const unsubscribe = subscribeToAuthChanges((event, session) => {
      if (event === "INITIAL_SESSION") return; // la cubre getSession() del arranque
      if (session === null) {
        void applySession(null);
        return;
      }
      if (event === "TOKEN_REFRESHED") {
        void refreshPrivileges();
        return;
      }
      // SIGNED_IN / USER_UPDATED: (re)valida privilegios desde la DB (D2).
      void applySession(session);
    });

    // Invalidación en refocus de pestaña (D2): si me dieron de baja desde
    // otro lado, my_role() vuelve NULL y los controles privilegiados desaparecen.
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        void refreshPrivileges();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [applySession, refreshPrivileges]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      userId: state.userId,
      email: state.email,
      role: state.role,
      premium: state.premium,
      refreshPrivileges,
      signOut,
    }),
    [state, refreshPrivileges, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth requiere un AuthProvider por encima en el árbol");
  }
  return context;
}
