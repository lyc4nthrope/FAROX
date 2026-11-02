import { corsHeaders, errorJson, isPost, json } from "../_shared/http.ts";
import { mpRequest } from "../_shared/mpClient.ts";
import { authHeader, serviceClient, userClient } from "../_shared/supabase.ts";

interface SubscriptionRow {
  id: number;
  status: string;
  provider_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }
  if (!isPost(request)) return errorJson("Método no permitido.", 405, true);

  const header = authHeader(request);
  if (header === null) return errorJson("Iniciá sesión para continuar.", 401, true);

  try {
    const auth = userClient(header);
    const { data: userData, error: userError } = await auth.auth.getUser();
    const user = userData.user;
    if (userError !== null || user === null) {
      return errorJson("Iniciá sesión para continuar.", 401, true);
    }

    const service = serviceClient();
    const { data: subscription, error: readError } = await service
      .from("subscriptions")
      .select(
        "id, status, provider_subscription_id, current_period_end, cancel_at_period_end",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<SubscriptionRow>();

    if (readError !== null) {
      return errorJson("No se pudo leer la suscripción.", 500, true);
    }
    if (subscription === null) {
      return errorJson("No tenés una suscripción para cancelar.", 404, true);
    }
    if (subscription.status === "cancelled") {
      return json(
        {
          status: "cancelled",
          cancel_at_period_end: true,
          current_period_end: subscription.current_period_end,
          already_cancelled: true,
        },
        200,
        true,
      );
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
      return errorJson("Se canceló en Mercado Pago, pero no se pudo guardar el estado local.", 500, true);
    }

    return json(
      {
        status: "cancelled",
        cancel_at_period_end: true,
        current_period_end: subscription.current_period_end,
      },
      200,
      true,
    );
  } catch {
    return errorJson("No se pudo cancelar la suscripción. Intentá de nuevo.", 500, true);
  }
});
