import { requireAdmin, writeAudit } from "../_shared/admin.ts";
import { corsHeaders, errorJson, isPost, json } from "../_shared/http.ts";
import { mpRequest } from "../_shared/mpClient.ts";

interface SubscriptionRow {
  id: number;
  user_id: string;
  status: string;
  provider_subscription_id: string | null;
  current_period_end: string | null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }
  if (!isPost(request)) return errorJson("Método no permitido.", 405, true);

  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;
  const { actor, service } = admin;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Datos inválidos.", 400, true);
  }
  const subscriptionId = Number(body["subscription_id"]);
  if (!Number.isInteger(subscriptionId) || subscriptionId < 1) {
    return errorJson("Suscripción inválida.", 400, true);
  }

  try {
    const { data: subscription, error: readError } = await service
      .from("subscriptions")
      .select("id, user_id, status, provider_subscription_id, current_period_end")
      .eq("id", subscriptionId)
      .maybeSingle<SubscriptionRow>();
    if (readError !== null) {
      return errorJson("No se pudo leer la suscripción.", 500, true);
    }
    if (subscription === null) {
      return errorJson("La suscripción no existe.", 404, true);
    }
    if (subscription.status === "cancelled") {
      return json({ status: "cancelled", already_cancelled: true }, 200, true);
    }
    if (subscription.status === "expired") {
      return errorJson("La suscripción ya venció.", 409, true);
    }
    if (
      subscription.provider_subscription_id === null ||
      subscription.provider_subscription_id === ""
    ) {
      return errorJson("La suscripción no está vinculada a Mercado Pago.", 409, true);
    }

    const mp = await mpRequest(`/preapproval/${subscription.provider_subscription_id}`, {
      method: "PUT",
      body: JSON.stringify({ status: "cancelled" }),
    });
    if (mp.error !== null) {
      return errorJson(
        "Mercado Pago no pudo cancelar la suscripción. Intentá de nuevo.",
        502,
        true,
      );
    }

    const { error: updateError } = await service
      .from("subscriptions")
      .update({ status: "cancelled", cancel_at_period_end: true })
      .eq("id", subscription.id);
    if (updateError !== null) {
      return errorJson("Se canceló en Mercado Pago, pero no se guardó el estado local.", 500, true);
    }

    await writeAudit(service, actor.id, "subscriptions", subscription.id, {
      status: "cancelled",
      cancel_at_period_end: true,
      by: "admin",
    });

    return json(
      {
        status: "cancelled",
        current_period_end: subscription.current_period_end,
      },
      200,
      true,
    );
  } catch {
    return errorJson("No se pudo cancelar la suscripción. Intentá de nuevo.", 500, true);
  }
});
