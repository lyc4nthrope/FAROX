import {
  addMonths,
  buildPreapprovalPayload,
  mapPreapprovalStatus,
  type PreapprovalResponse,
} from "../_shared/mercadopago.ts";
import { corsHeaders, errorJson, isPost, json } from "../_shared/http.ts";
import { mpRequest } from "../_shared/mpClient.ts";
import { authHeader, serviceClient, userClient } from "../_shared/supabase.ts";

const PLAN_CODES = new Set(["premium_monthly", "premium_annual"]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }
  if (!isPost(request)) return errorJson("Método no permitido.", 405, true);

  if (Deno.env.get("PREMIUM_CHECKOUT_ENABLED") !== "true") {
    return errorJson("El pago con Mercado Pago todavía no está habilitado.", 503, true);
  }

  const header = authHeader(request);
  if (header === null) return errorJson("Iniciá sesión para continuar.", 401, true);

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorJson("Datos inválidos.", 400, true);
  }
  const planCode = body["plan_code"];
  if (typeof planCode !== "string" || !PLAN_CODES.has(planCode)) {
    return errorJson("Elegí un plan válido.", 400, true);
  }

  const appUrl = Deno.env.get("APP_URL");
  if (appUrl === undefined || appUrl === "") {
    return errorJson("Falta configurar APP_URL.", 500, true);
  }

  try {
    const auth = userClient(header);
    const { data: userData, error: userError } = await auth.auth.getUser();
    const user = userData.user;
    const payerEmail = user?.email;
    if (userError !== null || user === null || payerEmail === null || payerEmail === undefined) {
      return errorJson("Iniciá sesión para continuar.", 401, true);
    }

    const allowlist = (Deno.env.get("PREMIUM_CHECKOUT_ALLOWLIST") ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email !== "");
    if (allowlist.length > 0 && !allowlist.includes(payerEmail.toLowerCase())) {
      return errorJson(
        "El pago está en pruebas. Pedile al administrador que active Premium manualmente.",
        403,
        true,
      );
    }

    const service = serviceClient();
    const { data: userRow, error: userRowError } = await service
      .from("users")
      .select("premium, premium_until, role:roles(name)")
      .eq("id", user.id)
      .maybeSingle();
    if (userRowError !== null) {
      return errorJson("No se pudo leer tu cuenta. Intentá de nuevo.", 500, true);
    }
    const premiumUntil =
      typeof userRow?.premium_until === "string" ? Date.parse(userRow.premium_until) : null;
    const roleRaw = userRow?.role;
    const role = Array.isArray(roleRaw) ? roleRaw[0] : roleRaw;
    const roleName =
      typeof role === "object" && role !== null ? (role as { name?: unknown }).name : undefined;
    const premiumActive =
      roleName === "admin" ||
      (userRow?.premium === true &&
        (premiumUntil === null || Number.isNaN(premiumUntil) || premiumUntil > Date.now()));
    if (premiumActive) {
      return errorJson("Ya tenés Premium activo. No necesitás pagar de nuevo.", 409, true);
    }

    const { data: plan, error: planError } = await service
      .from("plans")
      .select("id, code, name, currency, interval_months, active")
      .eq("code", planCode)
      .eq("active", true)
      .maybeSingle();
    if (planError !== null || plan === null) {
      return errorJson("El plan no está disponible.", 404, true);
    }

    const { data: version, error: versionError } = await service
      .from("plan_versions")
      .select("id, amount_cents, currency, interval_months")
      .eq("plan_id", plan.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionError !== null || version === null) {
      return errorJson("El plan no tiene precio configurado.", 500, true);
    }

    const { data: existing } = await service
      .from("subscriptions")
      .select("id, status, provider_subscription_id, provider_init_point, created_at")
      .eq("user_id", user.id)
      .in("status", ["pending", "authorized", "paused"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let existingReleased = false;
    if (existing !== null) {
      if (
        existing.status === "pending" &&
        typeof existing.provider_init_point === "string" &&
        existing.provider_init_point !== ""
      ) {
        if (
          typeof existing.provider_subscription_id === "string" &&
          existing.provider_subscription_id !== ""
        ) {
          const mpCheck = await mpRequest<PreapprovalResponse>(
            `/preapproval/${existing.provider_subscription_id}`,
          );
          if (mpCheck.error !== null || mpCheck.data === null) {
            return errorJson(
              "No se pudo verificar el estado del pago. Intentá de nuevo.",
              502,
              true,
            );
          }
          const mpStatus = mapPreapprovalStatus(mpCheck.data.status);
          if (mpStatus === "cancelled" || mpStatus === "expired") {
            await service
              .from("subscriptions")
              .update({ status: "cancelled" })
              .eq("id", existing.id);
            existingReleased = true;
          } else if (mpStatus === "authorized") {
            await service
              .from("subscriptions")
              .update({ status: "authorized" })
              .eq("id", existing.id);
            return errorJson(
              "Ya autorizaste el pago. Estamos confirmando la activación.",
              409,
              true,
            );
          } else if (mpStatus === "paused") {
            await service.from("subscriptions").update({ status: "paused" }).eq("id", existing.id);
            return errorJson("Tu suscripción está pausada. Gestionála desde tu perfil.", 409, true);
          } else if (mpStatus === null) {
            return errorJson(
              "No se pudo verificar el estado del pago. Intentá de nuevo.",
              502,
              true,
            );
          } else {
            return json(
              {
                init_point: existing.provider_init_point,
                subscription_id: existing.id,
                reused: true,
              },
              200,
              true,
            );
          }
        } else {
          return json(
            {
              init_point: existing.provider_init_point,
              subscription_id: existing.id,
              reused: true,
            },
            200,
            true,
          );
        }
      }
      if (existing.status === "pending" && !existingReleased) {
        const createdAt =
          typeof existing.created_at === "string" ? Date.parse(existing.created_at) : NaN;
        const stale = Number.isNaN(createdAt) || Date.now() - createdAt > 10 * 60 * 1000;
        if (stale) {
          // Un intento anterior quedó a medias; se libera el cupo de suscripción.
          await service.from("subscriptions").update({ status: "cancelled" }).eq("id", existing.id);
          existingReleased = true;
        } else {
          return errorJson(
            "Estamos preparando tu pago. Esperá unos segundos e intentá de nuevo.",
            409,
            true,
          );
        }
      } else if (!existingReleased) {
        return errorJson("Ya tenés una suscripción activa. Gestionála desde tu perfil.", 409, true);
      }
    }

    const externalReference = `farox-sub-${crypto.randomUUID()}`;
    const start = new Date().toISOString();
    const end = addMonths(start, version.interval_months);

    // La fila local existe ANTES de llamar a Mercado Pago: si el webhook llega
    // apenas se crea el preapproval, ya puede conciliar por external_reference.
    const { data: subscription, error: insertError } = await service
      .from("subscriptions")
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        plan_version_id: version.id,
        price_cents_at_signup: version.amount_cents,
        currency: version.currency,
        provider: "mercadopago",
        provider_subscription_id: null,
        external_reference: externalReference,
        provider_init_point: null,
        status: "pending",
        current_period_start: start,
        current_period_end: end,
      })
      .select("id")
      .single();
    if (insertError !== null || subscription === null) {
      const code = insertError === null ? null : (insertError as { code?: string }).code;
      if (code === "23505") {
        const { data: concurrent } = await service
          .from("subscriptions")
          .select("id, status, provider_init_point")
          .eq("user_id", user.id)
          .in("status", ["pending", "authorized", "paused"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (
          concurrent?.status === "pending" &&
          typeof concurrent.provider_init_point === "string" &&
          concurrent.provider_init_point !== ""
        ) {
          return json(
            {
              init_point: concurrent.provider_init_point,
              subscription_id: concurrent.id,
              reused: true,
            },
            200,
            true,
          );
        }
        return errorJson("Ya tenés una suscripción activa. Gestionála desde tu perfil.", 409, true);
      }
      return errorJson("No se pudo guardar la suscripción. Intentá de nuevo.", 500, true);
    }

    const backUrl = `${appUrl.replace(/\/$/, "")}/premium/resultado?ref=${encodeURIComponent(
      externalReference,
    )}`;
    const payload = buildPreapprovalPayload({
      planName: plan.name,
      amountCents: version.amount_cents,
      currency: version.currency,
      frequencyMonths: version.interval_months,
      payerEmail,
      externalReference,
      backUrl,
    });

    const mp = await mpRequest<PreapprovalResponse>("/preapproval", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const accessToken = Deno.env.get("MP_ACCESS_TOKEN") ?? "";
    const initPoint = accessToken.startsWith("TEST-")
      ? (mp.data?.sandbox_init_point ?? mp.data?.init_point)
      : mp.data?.init_point;
    if (mp.error !== null || mp.data === null || !mp.data.id || !initPoint) {
      if (typeof mp.data?.id === "string") {
        await mpRequest(`/preapproval/${mp.data.id}`, {
          method: "PUT",
          body: JSON.stringify({ status: "cancelled" }),
        });
      }
      await service.from("subscriptions").update({ status: "cancelled" }).eq("id", subscription.id);
      return errorJson("No se pudo iniciar el pago con Mercado Pago. Intentá de nuevo.", 502, true);
    }

    const mpStart = mp.data.date_created ?? start;
    const mpEnd = mp.data.next_payment_date ?? addMonths(mpStart, version.interval_months);
    const { error: updateError } = await service
      .from("subscriptions")
      .update({
        provider_subscription_id: mp.data.id,
        provider_init_point: initPoint,
        current_period_start: mpStart,
        current_period_end: mpEnd,
      })
      .eq("id", subscription.id);
    if (updateError !== null) {
      // Best effort: no dejar un preapproval huérfano si falló el guardado local.
      await mpRequest(`/preapproval/${mp.data.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: "cancelled" }),
      });
      await service.from("subscriptions").update({ status: "cancelled" }).eq("id", subscription.id);
      return errorJson("No se pudo guardar la suscripción. Intentá de nuevo.", 500, true);
    }

    return json({ init_point: initPoint, subscription_id: subscription.id }, 200, true);
  } catch {
    return errorJson("No se pudo iniciar el pago. Intentá de nuevo.", 500, true);
  }
});
