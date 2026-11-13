import { describe, expect, it } from "vitest";

import {
  extractTextMessages,
  extractVerificationCommands,
  parseActionCommand,
  parseVerificationCode,
  replyFor,
  verifyChallenge,
  verifyMetaSignature,
} from "./whatsapp";

async function sign(rawBody: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody)));
  let hex = "";
  for (const byte of signature) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return `sha256=${hex}`;
}

describe("verifyMetaSignature (x-hub-signature-256)", () => {
  const secret = "app-secret-de-prueba";
  const body = '{"object":"whatsapp_business_account"}';

  it("acepta la firma correcta", async () => {
    const header = await sign(body, secret);
    await expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: header, appSecret: secret }),
    ).resolves.toBe(true);
  });

  it("rechaza un body alterado", async () => {
    const header = await sign(body, secret);
    await expect(
      verifyMetaSignature({
        rawBody: `${body} `,
        signatureHeader: header,
        appSecret: secret,
      }),
    ).resolves.toBe(false);
  });

  it("rechaza un secret distinto", async () => {
    const header = await sign(body, "otro-secret");
    await expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: header, appSecret: secret }),
    ).resolves.toBe(false);
  });

  it("rechaza header ausente, sin prefijo o malformado", async () => {
    await expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: null, appSecret: secret }),
    ).resolves.toBe(false);
    await expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: "abc", appSecret: secret }),
    ).resolves.toBe(false);
    await expect(
      verifyMetaSignature({
        rawBody: body,
        signatureHeader: "sha256=no-es-hex",
        appSecret: secret,
      }),
    ).resolves.toBe(false);
  });

  it("rechaza si falta el app secret", async () => {
    const header = await sign(body, secret);
    await expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: header, appSecret: "" }),
    ).resolves.toBe(false);
  });
});

describe("verifyChallenge (GET de Meta)", () => {
  function params(entries: Record<string, string>): URLSearchParams {
    return new URLSearchParams(entries);
  }

  it("devuelve el challenge con el token correcto", () => {
    expect(
      verifyChallenge(
        params({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" }),
        "tok",
      ),
    ).toBe("123");
  });

  it("rechaza token incorrecto, modo incorrecto o token esperado vacío", () => {
    expect(
      verifyChallenge(
        params({ "hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "123" }),
        "tok",
      ),
    ).toBeNull();
    expect(
      verifyChallenge(
        params({ "hub.mode": "unsubscribe", "hub.verify_token": "tok", "hub.challenge": "123" }),
        "tok",
      ),
    ).toBeNull();
    expect(
      verifyChallenge(
        params({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "123" }),
        "",
      ),
    ).toBeNull();
  });
});

describe("extractTextMessages / comandos", () => {
  const payload = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  type: "text",
                  from: "573001234567",
                  id: "wamid.1",
                  text: { body: "FAROX A1B2C3" },
                },
                {
                  type: "text",
                  from: "573001234567",
                  id: "wamid.2",
                  text: { body: "CONFIRMAR A1B2C3" },
                },
                {
                  type: "text",
                  from: "573001234567",
                  id: "wamid.3",
                  text: { body: "¿Cuánto hay de arroz?" },
                },
                { type: "image", from: "573001234567", id: "wamid.4" },
              ],
            },
          },
        ],
      },
    ],
  };

  it("extrae solo textos con from, id y body", () => {
    expect(extractTextMessages(payload)).toEqual([
      { from: "573001234567", text: "FAROX A1B2C3", messageId: "wamid.1" },
      { from: "573001234567", text: "CONFIRMAR A1B2C3", messageId: "wamid.2" },
      { from: "573001234567", text: "¿Cuánto hay de arroz?", messageId: "wamid.3" },
    ]);
  });

  it("parsea el código de verificación y las acciones", () => {
    expect(parseVerificationCode("FAROX a1b2c3")).toBe("A1B2C3");
    expect(parseVerificationCode("FAROX")).toBeNull();
    expect(parseActionCommand("CONFIRMAR A1B2C3")).toEqual({
      action: "confirm",
      code: "A1B2C3",
    });
    expect(parseActionCommand("cancelar: a1b2c3")).toEqual({
      action: "cancel",
      code: "A1B2C3",
    });
    expect(parseActionCommand("CONFIRMAR")).toBeNull();
  });
});

function payload(messages: unknown[]): unknown {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "573000000000", phone_number_id: "pn" },
              messages,
            },
          },
        ],
      },
    ],
  };
}

describe("extractVerificationCommands", () => {
  it("extrae FAROX <código> y lo normaliza a mayúsculas", () => {
    expect(
      extractVerificationCommands(
        payload([
          {
            from: "573001234567",
            id: "wamid.1",
            type: "text",
            text: { body: "farox: a1b2c3" },
          },
        ]),
      ),
    ).toEqual([{ from: "573001234567", code: "A1B2C3", messageId: "wamid.1" }]);
  });

  it("acepta un código con typo alfanumérico (la RPC decide que es inválido)", () => {
    expect(
      extractVerificationCommands(
        payload([
          { from: "573001234567", id: "wamid.2", type: "text", text: { body: "FAROX ZZZZZZ" } },
        ]),
      )[0]?.code,
    ).toBe("ZZZZZZ");
  });

  it("ignora mensajes que no son texto y textos sin el comando", () => {
    expect(
      extractVerificationCommands(
        payload([
          { from: "573001234567", id: "wamid.3", type: "image", image: { id: "x" } },
          { from: "573001234567", id: "wamid.4", type: "text", text: { body: "hola" } },
          { from: "573001234567", id: "wamid.5", type: "text", text: { body: "FAROXA1B2C3" } },
        ]),
      ),
    ).toEqual([]);
  });

  it("procesa varios mensajes en el mismo payload", () => {
    const result = extractVerificationCommands(
      payload([
        { from: "573001111111", id: "a", type: "text", text: { body: "FAROX 111111" } },
        { from: "573002222222", id: "b", type: "text", text: { body: "FAROX 222222" } },
      ]),
    );
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.from)).toEqual(["573001111111", "573002222222"]);
  });

  it("tolera payloads incompletos", () => {
    expect(extractVerificationCommands(null)).toEqual([]);
    expect(extractVerificationCommands({})).toEqual([]);
    expect(extractVerificationCommands({ entry: [{ changes: [{ value: {} }] }] })).toEqual([]);
  });
});

describe("replyFor", () => {
  it("responde los resultados accionables", () => {
    expect(replyFor("verified")).toContain("verificado");
    expect(replyFor("phone_taken")).toContain("otra cuenta");
    expect(replyFor("invalid")).toContain("código");
    expect(replyFor("too_many_attempts")).toContain("intentos");
  });

  it("calla en expired y en resultados desconocidos", () => {
    expect(replyFor("expired")).toBeNull();
    expect(replyFor("")).toBeNull();
    expect(replyFor("otra-cosa")).toBeNull();
  });
});
