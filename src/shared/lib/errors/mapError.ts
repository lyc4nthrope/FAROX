// D5 · taxonomía de errores (T3.1 — spec #483 HARD-1 / FAROX-73, diseño #486).
// Orden de matcheo: SQLSTATE → código PostgREST → substring de mensaje.
// El texto crudo del backend JAMÁS se renderiza: toda UI de error pasa por
// mapError() y muestra SOLO estos strings amigables.
// Fuentes de los RAISE verificadas a mano: 0004:376 (D34), 0004:552/581/598/617
// (solo admin), 0004:555/318 (M11), 0004:559 (rol inexistente),
// 0004:656 (store_type inexistente), 0011:66 (assert_admin 'solo admin').

const FRIENDLY = {
  permissionDenied: "No tenés permisos para esta operación.",
  adminOnly: "Solo un administrador puede hacer esto.",
  distributorRole: "El rol distribuidor requiere elegir un distribuidor.",
  unknownRole: "El rol seleccionado no existe.",
  unknownStoreType: "El tipo de tienda no existe.",
  storeCap: "Alcanzaste el tope de tiendas (1 activa; 3 con premium).",
  missingData: "Faltan datos obligatorios (coordenadas).",
  notFound: "No se encontró el registro.",
  // sdd/admin-console T-B1 (ADM-8.4 / ADM-9.3 / ADM-5 "usuario inexistente"):
  // FK RESTRICT y UNIQUE llegan como SQLSTATE del server; los RAISE de las
  // RPCs de users (0011:105/121/136) como substring de mensaje.
  inUse: "Este registro está en uso y no se puede eliminar.",
  duplicateName: "Ya existe un registro con ese nombre.",
  userNotFound: "No se encontró el usuario.",
  invalidCredentials: "Email o contraseña incorrectos.",
  network: "No se pudo conectar, revisá tu conexión.",
  // Fallback propio (no está en la tabla D5): necesario para cumplir su
  // "raw text never rendered" ante cualquier error no catalogado.
  unexpected: "Ocurrió un error inesperado. Intentá de nuevo.",
} as const;

// sdd/admin-console T-E2: el hint del tope D34 de /stores REUTILIZA este copy
// en vez de duplicarlo — única fuente de verdad del string (mapError lo
// devuelve cuando el server levanta el RAISE del cap 0004:376).
export const STORE_CAP_MESSAGE = FRIENDLY.storeCap;

// Mensajes de RAISE EXCEPTION de las RPC (migraciones 0004–0015), en minúsculas.
// El orden importa: el primero que coincide gana.
const BUSINESS_RULES: ReadonlyArray<readonly [string, string]> = [
  ["ya existe un distribuidor con ese nit", "Ya hay un distribuidor registrado con ese NIT. Si es tu empresa, contactá al administrador."],
  ["ya tenés un distribuidor asociado", "Tu cuenta ya tiene un distribuidor asociado."],
  ["ya registraste un distribuidor", "Ya registraste un distribuidor; pedile al administrador cualquier cambio."],
  ["nit requerido", "El NIT es obligatorio."],
  ["ubicación requerida", "Elegí la ubicación de la tienda en el mapa."],
  ["usuario inactivo", "Tu cuenta está desactivada."],
  ["último administrador", "No se puede quitar al último administrador activo."],
  ["requiere premium", "Esta acción requiere una cuenta Premium."],
  ["stock insuficiente", "No hay stock suficiente para esa salida."],
  ["sin precio activo", "Ese producto no tiene precio en la tienda. Un administrador debe asignarle precio primero."],
  ["fuera del alcance", "Esa tienda no está en tu alcance."],
  ["sin alcance", "No tenés acceso a ese registro."],
  ["producto repetido", "Hay un producto repetido en la lista."],
  ["items vacíos", "Agregá al menos un producto."],
  ["items requeridos", "Agregá al menos un producto."],
  ["quantity debe ser > 0", "La cantidad debe ser mayor que 0."],
  ["excede la cantidad pedida", "La cantidad recibida no puede superar la pedida."],
  ["ya confirmado", "Este pedido ya fue confirmado."],
  ["no re-entregable", "El pedido no se puede entregar en su estado actual."],
  ["delivered solo se registra", "La entrega se registra con \"Confirmar entrega\"."],
  ["cancelar exige reason", "Para cancelar hay que escribir un motivo."],
  ["inactivo o inexistente", "Hay un registro inactivo o inexistente en el formulario."],
  ["no pertenece al pedido", "Ese producto no pertenece al pedido."],
  ["ya tiene reverso", "Ese movimiento ya fue revertido."],
  ["reverso-de-reverso", "No se puede revertir un reverso."],
  ["reason requerido", "Escribí un motivo."],
  ["route_date requerida", "Elegí la fecha de la ruta."],
  ["stop_order debe ser", "El orden de las paradas debe empezar en 1."],
  ["transición inválida", "Ese cambio de estado no está permitido."],
  ["excede el máximo de 366", "El rango de fechas no puede superar 366 días."],
  ["excede el saldo", "El pago supera el saldo pendiente."],
  ["ya tiene un crédito vigente", "Ese pedido ya tiene un crédito."],
  ["el fiado solo se registra", "Solo se puede fiar un pedido entregado."],
  ["price debe ser > 0", "El precio debe ser mayor que 0."],
  ["código de tienda inválido", "El código no corresponde a ninguna tienda activa. Pedile a la tienda su QR actual."],
  ["solo un distribuidor activo puede vincularse", "Solo una cuenta de distribuidor puede vincularse a una tienda."],
  ["solo el dueño de la tienda o un admin", "Solo el dueño de la tienda o un administrador puede hacer esto."],
  // Solicitudes tienda ↔ distribuidor (0021): el vínculo y la intersección de
  // catálogos se validan también en create_order.
  ["tienda y distribuidor son obligatorios", "Elegí tienda y distribuidor."],
  ["no está vinculado a la tienda", "Ese distribuidor no está vinculado a la tienda."],
  ["no está en el catálogo del distribuidor", "Ese producto no está disponible en el catálogo del distribuidor."],
  ["no está en el catálogo de la tienda", "Ese producto no está disponible en la tienda."],
  ["ningún item válido", "Agregá al menos un producto."],
];

// PostgrestError trae { message, code, details, hint }; AuthError trae
// { message, status }; un fetch rechazado trae TypeError. Se acepta unknown
// y se extrae lo mínimo: nunca se devuelve el original al caller.
interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

function extractCode(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error as ErrorLike;
    if (typeof code === "string") {
      return code;
    }
  }
  return null;
}

function extractMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as ErrorLike;
    if (typeof message === "string") {
      return message;
    }
  }
  return "";
}

/** Convierte cualquier error de backend/red en un mensaje amigable en español. */
export function mapError(error: unknown): string {
  const code = extractCode(error);
  const message = extractMessage(error).toLowerCase();

  // 1) SQLSTATE — PostgREST los expone en error.code.
  if (code === "42501") {
    return FRIENDLY.permissionDenied; // RLS / GRANT de columna
  }
  if (code === "23502") {
    return FRIENDLY.missingData; // not_null (p. ej. stores.location)
  }
  if (code === "23503") {
    // FK RESTRICT: users.role_id → roles (0002:73) y FKs de catálogos
    // (0002:97/98/99) — borrar un registro en uso trae este SQLSTATE.
    return FRIENDLY.inUse;
  }
  if (code === "23505") {
    // UNIQUE: roles.name (0002:43), brands.name (0002:51), store_types,
    // unit_types — nombre duplicado en catálogos.
    return FRIENDLY.duplicateName;
  }
  if (code === "PGRST116") {
    return FRIENDLY.notFound; // .single() sin fila
  }

  // 2) Substrings — RAISE de RPC/triggers y errores de auth de supabase-js.
  if (message.includes("solo admin")) {
    return FRIENDLY.adminOnly;
  }
  if (message.includes("m11") || message.includes("rol distribuidor requiere")) {
    return FRIENDLY.distributorRole;
  }
  if (message.includes("rol inexistente")) {
    return FRIENDLY.unknownRole;
  }
  if (message.includes("usuario inexistente")) {
    // RAISE de update_user_role / set_user_premium / set_user_active
    // (0011:105/121/136): el id no existe en public.users.
    return FRIENDLY.userNotFound;
  }
  if (message.includes("store_type inexistente")) {
    return FRIENDLY.unknownStoreType;
  }
  if (message.includes("d34") || message.includes("tope de tiendas")) {
    return FRIENDLY.storeCap;
  }
  if (message.includes("invalid login credentials")) {
    return FRIENDLY.invalidCredentials;
  }

  // Reglas de negocio de las RPC (RAISE EXCEPTION): substring → texto de UI.
  for (const [needle, friendly] of BUSINESS_RULES) {
    if (message.includes(needle)) {
      return friendly;
    }
  }

  // 3) Red / timeout — fetch rechazado por el navegador o el runtime.
  if (
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("timed out") ||
    message.includes("timeout")
  ) {
    return FRIENDLY.network;
  }

  return FRIENDLY.unexpected;
}
