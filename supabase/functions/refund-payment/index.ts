import { requireAdmin, writeAudit } from "../_shared/admin.ts";
import { corsHeaders, errorJson, isPost, json } from "../_shared/http.ts";
import { mpRequest } from "../_shared/mpClient.ts";

interface PaymentRow {
  id: number;
  user_id: string;
  status: string;
  provider_payment_id: string | null;
  amount_cents: number;
  currency: string;
}

interface RefundResponse {
  id?: number | string;
  status?: string;
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
  const paymentId = Number(body["payment_id"]);
  if (!Number.isInteger(paymentId) || paymentId < 1) {
    return errorJson("Pago inválido.", 400, true);
  }

  try {
    const { data: payment, error: readError } = await service
      .from("payments")
      .select("id, user_id, status, provider_payment_id, amount_cents, currency")
      .eq("id", paymentId)
      .maybeSingle<PaymentRow>();
    if (readError !== null) {
      return errorJson("No se pudo leer el pago.", 500, true);
    }
    if (payment === null) {
      return errorJson("El pago no existe.", 404, true);
    }
    if (payment.status !== "approved") {
      return errorJson("Solo se puede reembolsar un pago aprobado.", 409, true);
    }
    if (payment.provider_payment_id === null || payment.provider_payment_id === "") {
      return errorJson("El pago no está vinculado a Mercado Pago.", 409, true);
    }

    const mp = await mpRequest<RefundResponse>(
      `/v1/payments/${payment.provider_payment_id}/refunds`,
      { method: "POST", body: JSON.stringify({}) },
    );
    if (mp.error !== null) {
      return errorJson("Mercado Pago no pudo reembolsar el pago. Intentá de nuevo.", 502, true);
    }

    const { error: updateError } = await service
      .from("payments")
      .update({ status: "refunded" })
      .eq("id", payment.id);
    if (updateError !== null) {
      return errorJson("Se reembolsó en Mercado Pago, pero no se guardó el estado local.", 500, true);
    }

    await service.from("payment_events").insert({
      provider: "mercadopago",
      event_id: `refund:${mp.data?.id ?? payment.provider_payment_id}`,
      topic: "refund",
      payload: mp.data ?? {},
      processed_at: new Date().toISOString(),
    });

    await writeAudit(service, actor.id, "payments", payment.id, {
      status: "refunded",
      amount_cents: payment.amount_cents,
      currency: payment.currency,
      by: "admin",
    });

    return json({ status: "refunded", refund_id: mp.data?.id ?? null }, 200, true);
  } catch {
    return errorJson("No se pudo reembolsar el pago. Intentá de nuevo.", 500, true);
  }
});
