import {
  eventIdFor,
  extractDataId,
  extractTopic,
  verifySignature,
} from "../_shared/mercadopago.ts";
import { errorJson, isPost, json } from "../_shared/http.ts";
import { processTopic } from "../_shared/premiumProcessor.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (request) => {
  if (!isPost(request)) return errorJson("Método no permitido.", 405);

  const url = new URL(request.url);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Datos inválidos.", 400);
  }

  const dataId = extractDataId(url.searchParams, body);
  const topic = extractTopic(url.searchParams, body);
  if (dataId === null || topic === "") {
    return errorJson("Notificación incompleta.", 400);
  }

  const secret = Deno.env.get("MP_WEBHOOK_SECRET") ?? "";
  const valid = await verifySignature({
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
    dataId,
    secret,
  });
  if (!valid) return errorJson("Firma inválida.", 401);

  const service = serviceClient();
  const eventId = eventIdFor(body, topic, dataId);
  const { error: eventError } = await service.from("payment_events").insert({
    provider: "mercadopago",
    event_id: eventId,
    topic,
    payload: body,
  });
  if (eventError !== null && (eventError as { code?: string }).code !== "23505") {
    return errorJson("No se pudo registrar el evento.", 500);
  }

  try {
    await processTopic(service, topic, dataId);
    await service
      .from("payment_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("provider", "mercadopago")
      .eq("event_id", eventId);
    return json({ ok: true }, 200);
  } catch {
    return errorJson("No se pudo procesar el evento.", 500);
  }
});
