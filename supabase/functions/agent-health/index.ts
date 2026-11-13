import { isCronRequest, requireAdmin } from "../_shared/admin.ts";
import { corsHeaders, errorJson, json } from "../_shared/http.ts";
import { probeModel } from "../_shared/agent.ts";

// ============================================================================
// Chequeo de salud del modelo del asistente (1 token de salida).
//
// Lo llama un cron con x-cron-secret (o un admin con su JWT). Si el modelo
// primario ya no existe, responde 200 con fallback_used: true y deja la línea
// PRIMARY_MODEL_UNAVAILABLE en el log; si tampoco existe el fallback, responde
// 503 con MODEL_UNAVAILABLE. Con eso se dispara la alerta antes de que lo note
// un usuario.
// ============================================================================

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  let via: "cron" | "admin" = "cron";
  if (!isCronRequest(request)) {
    const admin = await requireAdmin(request);
    if ("response" in admin) return admin.response;
    via = "admin";
  }

  const apiKey = Deno.env.get("AGENT_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (apiKey === undefined || apiKey === "") {
    return errorJson("Falta configurar el asistente.", 500, true);
  }

  const baseUrl =
    Deno.env.get("AGENT_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta/openai";
  const primary = Deno.env.get("AGENT_MODEL") ?? "gemini-2.5-flash";
  const fallback = Deno.env.get("AGENT_FALLBACK_MODEL") ?? "gemini-2.5-flash-lite";

  const first = await probeModel({ apiKey, baseUrl, model: primary });
  const checkedAt = new Date().toISOString();

  if (first.ok) {
    return json(
      { ok: true, model: primary, fallback_used: false, via, checked_at: checkedAt },
      200,
      true,
    );
  }

  const second = await probeModel({ apiKey, baseUrl, model: fallback });
  const body = {
    ok: second.ok,
    model: second.ok ? fallback : primary,
    fallback_used: second.ok,
    base_url: baseUrl,
    primary_status: first.status,
    fallback_status: second.status,
    primary_detail: first.detail,
    via,
    checked_at: checkedAt,
  };

  if (second.ok) {
    console.warn("agent-health PRIMARY_MODEL_UNAVAILABLE", primary, first.status, first.detail);
    return json(body, 200, true);
  }

  console.error("agent-health MODEL_UNAVAILABLE", primary, first.status, fallback, second.status);
  return json(body, 503, true);
});
