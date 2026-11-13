export type NoticeKind =
  | "renewal_7"
  | "renewal_3"
  | "renewal_1"
  | "grace_ending"
  | "expired"
  | "downgraded"
  | "payment_failed"
  | "cancellation";

export interface NoticeData {
  name: string;
  appUrl: string;
}

export interface RenderedNotice {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const COPY: Record<NoticeKind, { subject: string; heading: string; body: string; cta: string }> = {
  renewal_7: {
    subject: "Tu Premium vence en 7 días",
    heading: "Tu Premium vence en 7 días",
    body: "Tu suscripción se renueva automáticamente. Si querés cancelar, podés hacerlo desde tu perfil sin penalidad.",
    cta: "Ver mi plan",
  },
  renewal_3: {
    subject: "Tu Premium vence en 3 días",
    heading: "Tu Premium vence en 3 días",
    body: "Tu suscripción se renueva automáticamente. Si querés cancelar, podés hacerlo desde tu perfil sin penalidad.",
    cta: "Ver mi plan",
  },
  renewal_1: {
    subject: "Tu Premium vence mañana",
    heading: "Tu Premium vence mañana",
    body: "Tu suscripción se renueva automáticamente. Si querés cancelar, podés hacerlo desde tu perfil sin penalidad.",
    cta: "Ver mi plan",
  },
  grace_ending: {
    subject: "Tu período de gracia termina mañana",
    heading: "Tu período de gracia termina mañana",
    body: "Después de la gracia, las tiendas adicionales se pausan sin borrar stock, pedidos, rutas ni créditos. Podés renovar o elegir una tienda principal.",
    cta: "Gestionar mis tiendas",
  },
  expired: {
    subject: "Tu Premium venció",
    heading: "Tu Premium venció",
    body: "Tus datos siguen intactos. Podés renovar para reactivar las tiendas pausadas o elegir una tienda principal.",
    cta: "Renovar Premium",
  },
  downgraded: {
    subject: "Tus tiendas adicionales se pausaron",
    heading: "Tus tiendas adicionales se pausaron",
    body: "Al vencer Premium, conservamos tu tienda principal y pausamos las demás sin borrar stock, pedidos, rutas ni créditos. Al renovar podés reactivarlas.",
    cta: "Gestionar mis tiendas",
  },
  payment_failed: {
    subject: "No pudimos cobrar tu Premium",
    heading: "No pudimos cobrar tu Premium",
    body: "Mercado Pago rechazó el cobro. Revisá tu medio de pago o renová manualmente para no perder el acceso.",
    cta: "Revisar mi plan",
  },
  cancellation: {
    subject: "Tu suscripción no se renovará",
    heading: "Tu suscripción no se renovará",
    body: "Cancelaste la renovación. El acceso sigue hasta el final del período pagado y tus datos se conservan.",
    cta: "Ver mi plan",
  },
};

export function renderNotice(kind: NoticeKind, data: NoticeData): RenderedNotice {
  const copy = COPY[kind];
  const name = escapeHtml(data.name.trim() === "" ? "hola" : data.name.trim());
  const url = `${data.appUrl.replace(/\/$/, "")}/premium`;
  const html = `<!doctype html>
<html lang="es">
  <body style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; color: #111827; line-height: 1.5;">
    <p>Hola ${name},</p>
    <h1 style="font-size: 20px;">${copy.heading}</h1>
    <p>${copy.body}</p>
    <p><a href="${url}" style="display: inline-block; background: #111827; color: #ffffff; padding: 10px 16px; border-radius: 8px; text-decoration: none;">${copy.cta}</a></p>
    <p style="font-size: 12px; color: #6b7280;">FAROX · Este aviso se envía porque tenés una cuenta con plan Premium o una suscripción asociada.</p>
  </body>
</html>`;
  const text = `Hola ${data.name.trim() === "" ? "hola" : data.name.trim()},\n\n${copy.heading}\n\n${copy.body}\n\n${copy.cta}: ${url}\n\nFAROX`;
  return { subject: copy.subject, html, text };
}
