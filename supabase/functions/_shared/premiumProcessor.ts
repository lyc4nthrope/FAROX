import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

import {
  addMonths,
  asString,
  amountCents,
  mapInvoiceStatus,
  mapPaymentStatus,
  mapPreapprovalStatus,
  type AuthorizedPaymentResponse,
  type PaymentResponse,
  type PreapprovalResponse,
  type SubscriptionStatus,
} from "./mercadopago.ts";
import { mpRequest } from "./mpClient.ts";

export interface SubscriptionRecord {
  id: number;
  user_id: string;
  plan_id: number;
  plan_version_id: number;
  price_cents_at_signup: number;
  currency: string;
  external_reference: string | null;
  provider_subscription_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  provider_init_point: string | null;
  cancel_at_period_end: boolean;
}

interface PaymentRecord {
  id: number;
  status: string;
}

type Service = SupabaseClient;

const SUBSCRIPTION_FIELDS =
  "id, user_id, plan_id, plan_version_id, price_cents_at_signup, currency, " +
  "external_reference, provider_subscription_id, status, current_period_start, " +
  "current_period_end, provider_init_point, cancel_at_period_end";

async function findSubscription(
  service: Service,
  input: { providerSubscriptionId?: string | null; externalReference?: string | null },
): Promise<SubscriptionRecord | null> {
  if (input.providerSubscriptionId !== undefined && input.providerSubscriptionId !== null) {
    const { data, error } = await service
      .from("subscriptions")
      .select(SUBSCRIPTION_FIELDS)
      .eq("provider_subscription_id", input.providerSubscriptionId)
      .maybeSingle<SubscriptionRecord>();
    if (error !== null) throw new Error(error.message);
    if (data !== null) return data;
  }
  if (input.externalReference !== undefined && input.externalReference !== null) {
    const { data, error } = await service
      .from("subscriptions")
      .select(SUBSCRIPTION_FIELDS)
      .eq("external_reference", input.externalReference)
      .maybeSingle<SubscriptionRecord>();
    if (error !== null) throw new Error(error.message);
    if (data !== null) return data;
  }
  return null;
}

async function intervalMonthsFor(service: Service, planVersionId: number): Promise<number> {
  const { data, error } = await service
    .from("plan_versions")
    .select("interval_months")
    .eq("id", planVersionId)
    .maybeSingle<{ interval_months: number }>();
  if (error !== null) throw new Error(error.message);
  return data?.interval_months ?? 1;
}

async function findPayment(
  service: Service,
  providerPaymentId: string,
): Promise<PaymentRecord | null> {
  const { data, error } = await service
    .from("payments")
    .select("id, status")
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle<PaymentRecord>();
  if (error !== null) throw new Error(error.message);
  return data;
}

async function preparePayment(
  service: Service,
  sub: SubscriptionRecord,
  input: {
    providerPaymentId: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    raw: unknown;
  },
): Promise<PaymentRecord> {
  const existing = await findPayment(service, input.providerPaymentId);
  if (existing !== null) {
    if (existing.status === "approved") return existing;
    if (existing.status === "refunded" || existing.status === "charged_back") return existing;
    const { error } = await service
      .from("payments")
      .update({
        status: "pending",
        amount_cents: input.amountCents,
        currency: input.currency,
        provider_reference: input.providerReference,
        raw_event: input.raw,
      })
      .eq("id", existing.id);
    if (error !== null) throw new Error(error.message);
    return { id: existing.id, status: "pending" };
  }

  const { data, error } = await service
    .from("payments")
    .insert({
      user_id: sub.user_id,
      subscription_id: sub.id,
      plan_id: sub.plan_id,
      plan_version_id: sub.plan_version_id,
      provider: "mercadopago",
      provider_payment_id: input.providerPaymentId,
      provider_reference: input.providerReference,
      amount_cents: input.amountCents,
      currency: input.currency,
      status: "pending",
      raw_event: input.raw,
    })
    .select("id, status")
    .single<PaymentRecord>();

  if (error !== null) {
    if ((error as { code?: string }).code === "23505") {
      const retry = await findPayment(service, input.providerPaymentId);
      if (retry !== null) return retry;
    }
    throw new Error(error.message);
  }
  return data;
}

async function recordPaymentStatus(
  service: Service,
  sub: SubscriptionRecord,
  input: {
    providerPaymentId: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    status: string;
    raw: unknown;
  },
): Promise<void> {
  const existing = await findPayment(service, input.providerPaymentId);
  if (existing !== null) {
    const terminal = input.status === "refunded" || input.status === "charged_back";
    if (existing.status === "approved" && !terminal) return;
    if (existing.status === "refunded" || existing.status === "charged_back") return;
    const { error } = await service
      .from("payments")
      .update({
        status: input.status,
        amount_cents: input.amountCents,
        currency: input.currency,
        provider_reference: input.providerReference,
        raw_event: input.raw,
      })
      .eq("id", existing.id);
    if (error !== null) throw new Error(error.message);
    return;
  }
  const { error } = await service.from("payments").insert({
    user_id: sub.user_id,
    subscription_id: sub.id,
    plan_id: sub.plan_id,
    plan_version_id: sub.plan_version_id,
    provider: "mercadopago",
    provider_payment_id: input.providerPaymentId,
    provider_reference: input.providerReference,
    amount_cents: input.amountCents,
    currency: input.currency,
    status: input.status,
    raw_event: input.raw,
  });
  if (error !== null && (error as { code?: string }).code !== "23505") {
    throw new Error(error.message);
  }
}

async function activateApprovedPayment(
  service: Service,
  sub: SubscriptionRecord,
  input: {
    providerPaymentId: string;
    providerReference: string;
    amountCents: number;
    currency: string;
    raw: unknown;
    startIso: string | null;
  },
): Promise<void> {
  const payment = await preparePayment(service, sub, input);
  if (payment.status === "approved") return;
  if (payment.status === "refunded" || payment.status === "charged_back") return;
  const months = await intervalMonthsFor(service, sub.plan_version_id);
  const start = input.startIso ?? new Date().toISOString();
  const { error } = await service.rpc("activate_premium_until", {
    p_user: sub.user_id,
    p_until: addMonths(start, months),
    p_payment_id: payment.id,
  });
  if (error !== null) throw new Error(error.message);
}

async function updatePeriod(
  service: Service,
  sub: SubscriptionRecord,
  startIso: string | null,
): Promise<void> {
  if (startIso === null) return;
  const months = await intervalMonthsFor(service, sub.plan_version_id);
  const { error } = await service.rpc("merge_subscription_period", {
    p_subscription: sub.id,
    p_start: startIso,
    p_end: addMonths(startIso, months),
  });
  if (error !== null) throw new Error(error.message);
}

export async function processPreapproval(service: Service, dataId: string): Promise<void> {
  const result = await mpRequest<PreapprovalResponse>(`/preapproval/${dataId}`);
  if (result.error !== null || result.data === null) {
    throw new Error(result.error ?? "No se pudo consultar el preapproval");
  }
  const preapproval = result.data;
  const sub = await findSubscription(service, {
    providerSubscriptionId: dataId,
    externalReference: asString(preapproval.external_reference),
  });
  if (sub === null) return;

  const status = mapPreapprovalStatus(preapproval.status) ?? sub.status;
  const { error } = await service
    .from("subscriptions")
    .update({
      status,
      cancel_at_period_end: status === "cancelled" ? true : sub.cancel_at_period_end,
      provider_init_point: preapproval.init_point ?? sub.provider_init_point,
    })
    .eq("id", sub.id);
  if (error !== null) throw new Error(error.message);
}

export async function processAuthorizedPayment(service: Service, dataId: string): Promise<void> {
  const result = await mpRequest<AuthorizedPaymentResponse>(`/authorized_payments/${dataId}`);
  if (result.error !== null || result.data === null) {
    throw new Error(result.error ?? "No se pudo consultar la factura");
  }
  const invoice = result.data;
  const sub = await findSubscription(service, {
    providerSubscriptionId: invoice.preapproval_id ?? null,
    externalReference: asString(invoice.external_reference),
  });
  if (sub === null) return;

  const amount = amountCents(invoice.transaction_amount);
  const currency = invoice.currency_id ?? "";
  if (
    amount === null ||
    amount !== sub.price_cents_at_signup ||
    currency.toUpperCase() !== sub.currency.toUpperCase()
  ) {
    return;
  }

  const providerPaymentId = asString(invoice.payment?.id) ?? asString(invoice.id) ?? dataId;
  const providerReference = `mp-invoice:${asString(invoice.id) ?? dataId}`;
  const status = mapInvoiceStatus(invoice);
  const start = invoice.date_created ?? invoice.debit_date ?? null;

  if (status === "approved") {
    await activateApprovedPayment(service, sub, {
      providerPaymentId,
      providerReference,
      amountCents: amount,
      currency,
      raw: invoice,
      startIso: start,
    });
    await updatePeriod(service, sub, start);
    return;
  }
  await recordPaymentStatus(service, sub, {
    providerPaymentId,
    providerReference,
    amountCents: amount,
    currency,
    status,
    raw: invoice,
  });
}

export async function processPayment(service: Service, dataId: string): Promise<void> {
  const result = await mpRequest<PaymentResponse>(`/v1/payments/${dataId}`);
  if (result.error !== null || result.data === null) {
    throw new Error(result.error ?? "No se pudo consultar el pago");
  }
  const payment = result.data;
  const externalReference = asString(payment.external_reference);
  const sub = await findSubscription(service, { externalReference });
  if (sub === null) return;

  const amount = amountCents(payment.transaction_amount);
  const currency = payment.currency_id ?? "";
  if (
    amount === null ||
    amount !== sub.price_cents_at_signup ||
    currency.toUpperCase() !== sub.currency.toUpperCase()
  ) {
    return;
  }

  const providerPaymentId = asString(payment.id) ?? dataId;
  const providerReference = `mp-payment:${providerPaymentId}`;
  const status = mapPaymentStatus(payment.status);

  if (status === "approved") {
    await activateApprovedPayment(service, sub, {
      providerPaymentId,
      providerReference,
      amountCents: amount,
      currency,
      raw: payment,
      startIso: payment.date_approved ?? null,
    });
    await updatePeriod(service, sub, payment.date_approved ?? null);
    return;
  }
  await recordPaymentStatus(service, sub, {
    providerPaymentId,
    providerReference,
    amountCents: amount,
    currency,
    status,
    raw: payment,
  });
}

export async function processTopic(service: Service, topic: string, dataId: string): Promise<void> {
  if (topic === "subscription_preapproval") {
    await processPreapproval(service, dataId);
    return;
  }
  if (topic === "subscription_authorized_payment") {
    await processAuthorizedPayment(service, dataId);
    return;
  }
  if (topic === "payment") {
    await processPayment(service, dataId);
  }
}
