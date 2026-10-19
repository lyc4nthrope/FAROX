import { Navigate, Outlet } from "react-router-dom";

import { useAuth } from "../providers/AuthProvider";
import { SessionLoading } from "./SessionLoading";

// Guardia de sesión (V0-2): sin sesión activa → /login y CERO llamadas de
// datos — este guard solo lee el estado en memoria del AuthProvider.
export function RequireAuth() {
  const { status } = useAuth();
  if (status === "loading") return <SessionLoading />;
  if (status === "anon") return <Navigate to="/login" replace />;
  return <Outlet />;
}
