import { isCronRequest, requireAdmin } from "../_shared/admin.ts";
import { corsHeaders, errorJson, isPost, json } from "../_shared/http.ts";
import { renderNotice, type NoticeKind } from "../_shared/notices.ts";
import { serviceClient } from "../_shared/supabase.ts";

interface NoticeRow {
  id: number;
  user_id: string;
  kind: string;
  period_key: string;
  user:
    | { full_name?: string; email?: string | null }
    | Array<{ full_name?: string; email?: string | null }>;
}

const KINDS: ReadonlySet<string> = new Set([
  "renewal_7",
  "renewal_3",
  "renewal_1",
  "grace_ending",
  "expired",
  "downgraded",
  "payment_failed",
  "cancellation",
]);

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

  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const appUrl = Deno.env.get("APP_URL");

  try {
    const { data: enqueued, error: enqueueError } = await service.rpc("enqueue_premium_notices");
    if (enqueueError !== null) {
      return errorJson("No se pudieron preparar los avisos.", 500, true);
    }
    if (!apiKey || !from || !appUrl) {
      return errorJson(
        "El envío de avisos no está configurado (RESEND_API_KEY, EMAIL_FROM, APP_URL). Los avisos quedaron pendientes.",
        503,
        true,
      );
    }

    const { data: notices, error: noticesError } = await service
      .from("premium_notices")
      .select("id, user_id, kind, period_key, user:users(full_name,email)")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    if (noticesError !== null) {
      return errorJson("No se pudieron leer los avisos pendientes.", 500, true);
    }

    const rows = Array.isArray(notices) ? (notices as NoticeRow[]) : [];
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
      const userRaw = row.user;
      const user = Array.isArray(userRaw) ? userRaw[0] : userRaw;
      const email = typeof user?.email === "string" ? user.email : null;
      const name = typeof user?.full_name === "string" ? user.full_name : "";
      if (email === null || !KINDS.has(row.kind)) {
        failed += 1;
        await service
          .from("premium_notices")
          .update({ status: "failed", error: "sin email o tipo inválido" })
          .eq("id", row.id);
        continue;
      }

      const rendered = renderNotice(row.kind as NoticeKind, { name, appUrl });
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [email],
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 500);
          failed += 1;
          await service
            .from("premium_notices")
            .update({ status: "failed", error: `Resend ${response.status}: ${detail}` })
            .eq("id", row.id);
          continue;
        }
        sent += 1;
        await service
          .from("premium_notices")
          .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
          .eq("id", row.id);
      } catch (error) {
        failed += 1;
        await service
          .from("premium_notices")
          .update({
            status: "failed",
            error: error instanceof Error ? error.message : "error de red",
          })
          .eq("id", row.id);
      }
    }

    return json(
      {
        enqueued: typeof enqueued === "number" ? enqueued : Number(enqueued ?? 0),
        sent,
        failed,
      },
      200,
      true,
    );
  } catch {
    return errorJson("No se pudieron enviar los avisos.", 500, true);
  }
});
