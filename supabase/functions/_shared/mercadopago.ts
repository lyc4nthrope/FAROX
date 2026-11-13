// Shared Mercado Pago helpers for the F4 Edge Functions.
// Pure TypeScript: no Deno APIs here, so Vitest can exercise the logic.

export const MP_API_BASE = "https://api.mercadopago.com";

export type SubscriptionStatus = "pending" | "authorized" | "paused" | "cancelled" | "expired";
export type PaymentStatus = "pending" | "approved" | "rejected" | "refunded" | "charged_back";

export interface PreapprovalPayloadInput {
  planName: string;
  amountCents: number;
  currency: string;
  frequencyMonths: number;
  payerEmail: string;
  externalReference: string;
  backUrl: string;
}

export interface PreapprovalPayload {
  reason: string;
  external_reference: string;
  payer_email: string;
  back_url: string;
  auto_recurring: {
    frequency: number;
    frequency_type: "months";
    transaction_amount: number;
    currency_id: string;
  };
}

export interface PreapprovalResponse {
  id?: string;
  status?: string;
  init_point?: string;
  sandbox_init_point?: string;
  external_reference?: string;
  date_created?: string;
  next_payment_date?: string;
  auto_recurring?: {
    frequency?: number;
    frequency_type?: string;
    transaction_amount?: number | string;
    currency_id?: string;
  };
}

export interface AuthorizedPaymentResponse {
  id?: number | string;
  preapproval_id?: string;
  external_reference?: string | number;
  currency_id?: string;
  transaction_amount?: number | string;
  status?: string;
  date_created?: string;
  debit_date?: string;
  payment?: {
    id?: number | string;
    status?: string;
    status_detail?: string;
  };
}

export interface PaymentResponse {
  id?: number | string;
  status?: string;
  status_detail?: string;
  external_reference?: string | number;
  transaction_amount?: number | string;
  currency_id?: string;
  date_approved?: string;
  payment_method_id?: string;
}

export function buildPreapprovalPayload(input: PreapprovalPayloadInput): PreapprovalPayload {
  return {
    reason: `FAROX ${input.planName}`,
    external_reference: input.externalReference,
    payer_email: input.payerEmail,
    back_url: input.backUrl,
    auto_recurring: {
      frequency: input.frequencyMonths,
      frequency_type: "months",
      transaction_amount: Math.round(input.amountCents) / 100,
      currency_id: input.currency,
    },
  };
}

export function parseSignature(header: string | null): { ts: string; v1: string } | null {
  if (header === null || header.trim() === "") return null;
  const parts: Record<string, string> = {};
  for (const raw of header.split(",")) {
    const index = raw.indexOf("=");
    if (index <= 0) continue;
    const key = raw.slice(0, index).trim();
    const value = raw.slice(index + 1).trim();
    if (key !== "") parts[key] = value;
  }
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (ts === undefined || v1 === undefined || ts === "" || v1 === "") return null;
  return { ts, v1 };
}

export function buildManifest(dataId: string, requestId: string, ts: string): string {
  return `id:${dataId};request-id:${requestId};ts:${ts};`;
}

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function timingSafeEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Validates Mercado Pago's x-signature. The manifest is exact:
 * `id:{data.id};request-id:{x-request-id};ts:{ts};`
 */
export async function verifySignature(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}): Promise<boolean> {
  if (input.xRequestId === null || input.dataId === null || input.secret === "") return false;
  const parsed = parseSignature(input.xSignature);
  if (parsed === null) return false;
  const manifest = buildManifest(input.dataId, input.xRequestId, parsed.ts);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(manifest));
  return timingSafeEqualHex(toHex(new Uint8Array(signature)), parsed.v1.toLowerCase());
}

export function mapPreapprovalStatus(status: string | undefined): SubscriptionStatus | null {
  switch ((status ?? "").toLowerCase()) {
    case "pending":
      return "pending";
    case "authorized":
      return "authorized";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "finished":
    case "expired":
      return "expired";
    default:
      return null;
  }
}

export function mapInvoiceStatus(invoice: AuthorizedPaymentResponse): PaymentStatus {
  const raw = (invoice.payment?.status ?? invoice.status ?? "").toLowerCase();
  return mapPaymentStatus(raw);
}

export function mapPaymentStatus(status: string | undefined): PaymentStatus {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
      return "approved";
    case "refunded":
      return "refunded";
    case "charged_back":
      return "charged_back";
    case "rejected":
    case "cancelled":
      return "rejected";
    default:
      return "pending";
  }
}

export function amountCents(value: number | string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

export function matchesAmountAndCurrency(
  amount: number | string | undefined,
  currency: string | undefined,
  expectedCents: number,
  expectedCurrency: string,
): boolean {
  const cents = amountCents(amount);
  if (cents === null) return false;
  return (
    cents === expectedCents && (currency ?? "").toUpperCase() === expectedCurrency.toUpperCase()
  );
}

export function addMonths(dateIso: string, months: number): string {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return dateIso;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export function extractDataId(
  searchParams: URLSearchParams,
  body: Record<string, unknown>,
): string | null {
  const fromQuery = searchParams.get("data.id") ?? searchParams.get("data_id");
  if (fromQuery !== null && fromQuery !== "") return fromQuery;
  const data = body["data"];
  if (typeof data === "object" && data !== null && "id" in data) {
    const id = (data as { id?: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return String(id);
  }
  return null;
}

export function extractTopic(searchParams: URLSearchParams, body: Record<string, unknown>): string {
  const fromBody = body["type"] ?? body["topic"];
  if (typeof fromBody === "string" && fromBody !== "") return fromBody;
  return searchParams.get("type") ?? searchParams.get("topic") ?? "";
}

export function eventIdFor(body: Record<string, unknown>, topic: string, dataId: string): string {
  const id = body["id"];
  if (typeof id === "string" || typeof id === "number") return String(id);
  return `${topic}:${dataId}`;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string | null {
  if (typeof value === "string" && value !== "") return value;
  if (typeof value === "number") return String(value);
  return null;
}
