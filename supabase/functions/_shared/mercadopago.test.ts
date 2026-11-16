// @vitest-environment node
import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  addMonths,
  amountCents,
  buildManifest,
  buildPreapprovalPayload,
  eventIdFor,
  extractDataId,
  extractTopic,
  mapInvoiceStatus,
  mapPaymentStatus,
  mapPreapprovalStatus,
  matchesAmountAndCurrency,
  parseSignature,
  verifySignature,
} from "./mercadopago";

const SECRET = "test-webhook-secret";
const DATA_ID = "123456789";
const REQUEST_ID = "4ed4fa2b-0b31-42ec-a62f-ad793c486c59";
const TS = "1704908010";

function signatureFor(manifest: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

describe("Mercado Pago signature", () => {
  it("parsea ts y v1 del header", () => {
    expect(parseSignature(`ts=${TS},v1=abc`)).toEqual({ ts: TS, v1: "abc" });
    expect(parseSignature("ts=,v1=abc")).toBeNull();
    expect(parseSignature(null)).toBeNull();
  });

  it("construye el manifiesto exacto con punto y coma final", () => {
    expect(buildManifest(DATA_ID, REQUEST_ID, TS)).toBe(
      `id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`,
    );
  });

  it("acepta una firma HMAC-SHA256 válida", async () => {
    const manifest = buildManifest(DATA_ID, REQUEST_ID, TS);
    const v1 = signatureFor(manifest);
    await expect(
      verifySignature({
        xSignature: `ts=${TS},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).resolves.toBe(true);
  });

  it("falla cerrado sin x-request-id, sin data.id o sin secreto", async () => {
    const manifest = buildManifest(DATA_ID, REQUEST_ID, TS);
    const v1 = signatureFor(manifest);
    const base = {
      xSignature: `ts=${TS},v1=${v1}`,
      xRequestId: REQUEST_ID,
      dataId: DATA_ID,
      secret: SECRET,
    };
    await expect(verifySignature({ ...base, xRequestId: null })).resolves.toBe(false);
    await expect(verifySignature({ ...base, dataId: null })).resolves.toBe(false);
    await expect(verifySignature({ ...base, secret: "" })).resolves.toBe(false);
  });

  it("rechaza firma inválida, secreto distinto o datos cambiados", async () => {
    const manifest = buildManifest(DATA_ID, REQUEST_ID, TS);
    const v1 = signatureFor(manifest);
    await expect(
      verifySignature({
        xSignature: `ts=${TS},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: "999",
        secret: SECRET,
      }),
    ).resolves.toBe(false);
    await expect(
      verifySignature({
        xSignature: `ts=${TS},v1=${v1}`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: "otro",
      }),
    ).resolves.toBe(false);
    await expect(
      verifySignature({
        xSignature: `ts=${TS},v1=00`,
        xRequestId: REQUEST_ID,
        dataId: DATA_ID,
        secret: SECRET,
      }),
    ).resolves.toBe(false);
  });
});

describe("Mercado Pago payload/estados", () => {
  it("crea el preapproval con monto en pesos y frecuencia en meses", () => {
    expect(
      buildPreapprovalPayload({
        planName: "Premium mensual",
        amountCents: 1000000,
        currency: "COP",
        frequencyMonths: 1,
        payerEmail: "demo@farox.app",
        externalReference: "farox-sub-1",
        backUrl: "https://farox.app/premium/resultado?ref=farox-sub-1",
      }),
    ).toEqual({
      reason: "FAROX Premium mensual",
      external_reference: "farox-sub-1",
      payer_email: "demo@farox.app",
      back_url: "https://farox.app/premium/resultado?ref=farox-sub-1",
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: 10000,
        currency_id: "COP",
      },
    });
  });

  it("mapea estados de preapproval, invoice y payment", () => {
    expect(mapPreapprovalStatus("authorized")).toBe("authorized");
    expect(mapPreapprovalStatus("cancelled")).toBe("cancelled");
    expect(mapPreapprovalStatus("desconocido")).toBeNull();
    expect(mapInvoiceStatus({ payment: { status: "approved" } })).toBe("approved");
    expect(mapInvoiceStatus({ status: "scheduled" })).toBe("pending");
    expect(mapPaymentStatus("rejected")).toBe("rejected");
    expect(mapPaymentStatus("charged_back")).toBe("charged_back");
  });

  it("valida monto y moneda sin confiar en el cliente", () => {
    expect(amountCents("10000.00")).toBe(1000000);
    expect(amountCents(undefined)).toBeNull();
    expect(matchesAmountAndCurrency("10000.00", "COP", 1000000, "COP")).toBe(true);
    expect(matchesAmountAndCurrency("9999.00", "COP", 1000000, "COP")).toBe(false);
    expect(matchesAmountAndCurrency("10000.00", "ARS", 1000000, "COP")).toBe(false);
  });

  it("suma meses sin desbordar el día", () => {
    expect(addMonths("2026-01-31T12:00:00.000Z", 1)).toBe("2026-02-28T12:00:00.000Z");
    expect(addMonths("2026-12-15T12:00:00.000Z", 12)).toBe("2027-12-15T12:00:00.000Z");
  });

  it("extrae data.id, topic y event id del query/body", () => {
    const query = new URLSearchParams("data.id=123&type=payment");
    const body = { id: 55, type: "payment", data: { id: "123" } };
    expect(extractDataId(query, body)).toBe("123");
    expect(extractDataId(new URLSearchParams(), body)).toBe("123");
    expect(extractTopic(query, body)).toBe("payment");
    expect(eventIdFor(body, "payment", "123")).toBe("55");
    expect(eventIdFor({}, "payment", "123")).toBe("payment:123");
  });
});
