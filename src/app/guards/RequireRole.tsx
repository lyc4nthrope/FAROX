import type { ReactNode } from "react";

import type { RoleName } from "../../features/auth/types";
import { useAuth } from "../providers/AuthProvider";
import { AccessDenied } from "./AccessDenied";
import { SessionLoading } from "./SessionLoading";

interface RequireRoleProps {
  roles: readonly RoleName[];
  children: ReactNode;
}

// Guardia de rol (§S2 denegación): deniega ANTES de montar la pantalla, así
// ninguna query del feature llega a emitirse. Rol null (inactivo, fila
// ausente — V0-3) también queda denegado en rutas con rol mínimo.
export function RequireRole({ roles, children }: RequireRoleProps) {
  const { status, role } = useAuth();
  if (status === "loading") return <SessionLoading />;
  if (role !== null && roles.includes(role)) {
    return <>{children}</>;
  }
  return <AccessDenied />;
}
