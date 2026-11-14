import { isCronRequest, requireAdmin } from "../_shared/admin.ts";
import { corsHeaders, errorJson, isPost, json } from "../_shared/http.ts";
import { processPayment, processPreapproval } from "../_shared/premiumProcessor.ts";
import { serviceClient } from "../_shared/supabase.ts";

interface SubscriptionRow {
  id: number;
  provider_subscription_id: string;
}

interface PaymentRow {
  id: number;
  provider_payment_id: string;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }
  if (!isPost(request)) return errorJson("Método no permitido.", 405, true);

  let service = serviceClient();
  if (!isCronRequest(request)) {
    const admin = await requireAdmin(request);
    if ("response" in admin) return admin.response;
    service = admin.service;
  }

  try {
    const { data: subscriptions, error: subscriptionsError } = await service
      .from("subscriptions")
      .select("id, provider_subscription_id")
      .in("status", ["pending", "authorized", "paused"])
      .not("provider_subscription_id", "is", null)
      .order("last_reconciled_at", { ascending: true, nullsFirst: true })
      .limit(50);
    if (subscriptionsError !== null) {
      return errorJson("No se pudieron leer las suscripciones.", 500, true);
    }

    const { data: payments, error: paymentsError } = await service
      .from("payments")
      .select("id, provider_payment_id")
      .eq("status", "pending")
      .not("provider_payment_id", "is", null)
      .order("last_reconciled_at", { ascending: true, nullsFirst: true })
      .limit(50);
    if (paymentsError !== null) {
      return errorJson("No se pudieron leer los pagos.", 500, true);
    }

    const subscriptionRows = Array.isArray(subscriptions)
      ? (subscriptions as SubscriptionRow[])
      : [];
    const paymentRows = Array.isArray(payments) ? (payments as PaymentRow[]) : [];
    let updated = 0;
    let errors = 0;

    for (const row of subscriptionRows) {
      try {
        await processPreapproval(service, row.provider_subscription_id);
        updated += 1;
      } catch {
        errors += 1;
      } finally {
        try {
          const { error: markError } = await service
            .from("subscriptions")
            .update({ last_reconciled_at: new Date().toISOString() })
            .eq("id", row.id);
          if (markError !== null) errors += 1;
        } catch {
          errors += 1;
        }
      }
    }
    for (const row of paymentRows) {
      try {
        await processPayment(service, row.provider_payment_id);
        updated += 1;
      } catch {
        errors += 1;
      } finally {
        try {
          const { error: markError } = await service
            .from("payments")
            .update({ last_reconciled_at: new Date().toISOString() })
            .eq("id", row.id);
          if (markError !== null) errors += 1;
        } catch {
          errors += 1;
        }
      }
    }

    return json(
      {
        checkedSubscriptions: subscriptionRows.length,
        checkedPayments: paymentRows.length,
        updated,
        errors,
      },
      200,
      true,
    );
  } catch {
    return errorJson("No se pudo conciliar con Mercado Pago.", 500, true);
  }
});
