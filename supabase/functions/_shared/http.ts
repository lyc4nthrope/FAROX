export function appOrigin(): string {
  const configured = Deno.env.get("APP_URL") ?? "";
  try {
    return new URL(configured).origin;
  } catch {
    return "*";
  }
}

export function corsHeaders(): Record<string, string> {
  if (appOrigin() === "*") {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
  }
  return {
    "Access-Control-Allow-Origin": appOrigin(),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(body: unknown, status = 200, withCors = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...(withCors ? corsHeaders() : {}),
    },
  });
}

export function errorJson(message: string, status: number, withCors = false): Response {
  return json({ error: message }, status, withCors);
}

export function isPost(request: Request): boolean {
  return request.method === "POST";
}
