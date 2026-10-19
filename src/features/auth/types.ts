// Roles sembrados en la DB (20261015000005_seeds.sql:18-22). La única fuente
// de verdad del rol es my_role() — D2 (obs #486): nunca el JWT ni localStorage.
export const ROLE_NAMES = ["admin", "operador", "distribuidor"] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

// Privilegios leídos de la DB post-sign-in (my_role + is_premium). role null =
// inactivo, fila public.users ausente o error: la UI degrada sin privilegios (V0-3).
export interface Privileges {
  role: RoleName | null;
  premium: boolean;
}

// Normaliza lo que devuelve my_role(): un nombre fuera del catálogo de roles
// (o cualquier basura) se trata como "sin rol" — nunca como privilegio.
export function normalizeRole(value: unknown): RoleName | null {
  const match = ROLE_NAMES.find((name) => name === value);
  return match ?? null;
}
