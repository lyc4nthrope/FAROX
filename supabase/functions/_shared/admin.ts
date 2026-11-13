import { errorJson } from "./http.ts";
import { authHeader, serviceClient, userClient } from "./supabase.ts";

export interface AdminActor {
  id: string;
  email: string | null;
}

type AdminResult =
  { actor: AdminActor; service: ReturnType<typeof serviceClient> } | { response: Response };

export async function requireAdmin(request: Request): Promise<AdminResult> {
  const header = authHeader(request);
  if (header === null) {
    return { response: errorJson("Iniciá sesión para continuar.", 401, true) };
  }
  try {
    const auth = userClient(header);
    const { data: userData, error: userError } = await auth.auth.getUser();
    const user = userData.user;
    if (userError !== null || user === null) {
      return { response: errorJson("Iniciá sesión para continuar.", 401, true) };
    }
    const service = serviceClient();
    const { data: row, error: rowError } = await service
      .from("users")
      .select("is_active, role:roles(name)")
      .eq("id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (rowError !== null) {
      return { response: errorJson("No se pudo verificar tu rol.", 500, true) };
    }
    const roleRaw = row?.role;
    const role = Array.isArray(roleRaw) ? roleRaw[0] : roleRaw;
    const roleName =
      typeof role === "object" && role !== null ? (role as { name?: unknown }).name : undefined;
    if (roleName !== "admin" || row?.is_active !== true) {
      return { response: errorJson("Solo un administrador activo puede hacer esto.", 403, true) };
    }
    return {
      actor: { id: user.id, email: user.email ?? null },
      service,
    };
  } catch {
    return { response: errorJson("No se pudo verificar tu rol.", 500, true) };
  }
}

function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

export function isCronRequest(request: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  const provided = request.headers.get("x-cron-secret") ?? "";
  return secret !== undefined && secret !== "" && timingSafeEqual(provided, secret);
}

export async function writeAudit(
  service: ReturnType<typeof serviceClient>,
  actorId: string | null,
  tableName: string,
  rowId: string | number,
  diff: Record<string, unknown>,
): Promise<void> {
  await service.from("audit_log").insert({
    created_by: actorId,
    table_name: tableName,
    action: "update",
    row_id: String(rowId),
    diff,
  });
}
