import { MP_API_BASE } from "./mercadopago.ts";

export interface MpResult<T> {
  data: T | null;
  status: number;
  error: string | null;
}

function accessToken(): string {
  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (token === undefined || token === "") {
    throw new Error("Falta el secret MP_ACCESS_TOKEN");
  }
  return token;
}

export async function mpRequest<T>(path: string, init: RequestInit = {}): Promise<MpResult<T>> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken()}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  try {
    const response = await fetch(`${MP_API_BASE}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const message =
        typeof parsed === "object" && parsed !== null && "message" in parsed
          ? String((parsed as { message: unknown }).message)
          : `Mercado Pago respondió ${response.status}`;
      return { data: null, status: response.status, error: message };
    }
    return { data: (parsed as T) ?? null, status: response.status, error: null };
  } catch (error) {
    return {
      data: null,
      status: 502,
      error: error instanceof Error ? error.message : "Mercado Pago no respondió",
    };
  }
}
