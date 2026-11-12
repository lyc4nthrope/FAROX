// §S8 negative gate — spec #483 §S8-1..4 · tasks #488 T1.4.
// Escanea src/ y falla ante CUALQUIER coincidencia de: RPCs diferidos (21),
// tablas diferidas (15), search_vector, service_role, canales de realtime
// o INSERT/UPSERT directo en stores (STORE-1: INSERT revoked, 0006:360).
// Node puro, sin dependencias — corre igual en local (Windows) y en CI (linux).
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

// §S8-1 · 21 RPCs diferidos (whitelist Base:642-659; 10 en alcance + 21 = 31).
// 0039: create_chat / send_message / chat_* ya son parte del alcance real
// (asistente de consultas), asi que salen de las listas diferidas.
const DEFERRED_RPCS = [
  "get_stock",
];

// Tablas todavía no habilitadas en el front (el resto ya tiene slice).
const DEFERRED_TABLES = [
  "order_items",
  "dashboard_daily",
];

const QUOTE = "['\"`]";

const RULES = [
  ...DEFERRED_RPCS.map((name) => ({
    name: `RPC diferido: ${name}`,
    regex: new RegExp(`\\.rpc\\(\\s*${QUOTE}${name}${QUOTE}`),
  })),
  ...DEFERRED_TABLES.map((name) => ({
    name: `tabla diferida: ${name}`,
    regex: new RegExp(`\\.from\\(\\s*${QUOTE}${name}${QUOTE}`),
  })),
  { name: "search_vector (§S8-4)", regex: /search_vector/ },
  { name: "service_role en el front (§S8-4)", regex: /service_role/ },
  { name: "canal de realtime (§S8-4)", regex: /\.channel\(|postgres_changes/ },
  {
    // STORE-1 negative: INSERT directo en stores está REVOKE-ado (0006:360) —
    // la creación pasa SOLO por rpc create_store. upsert incluido: también inserta.
    name: "INSERT/UPSERT directo en stores (STORE-1)",
    regex: new RegExp(`\\.from\\(\\s*${QUOTE}stores${QUOTE}\\s*\\)\\s*\\.\\s*(insert|upsert)\\b`, "s"),
  },
];

// C5 (dashboard INT-01): Base D32 eligió realtime sobre polling por costo, así
// que el canal se permite SOLO en los archivos del dashboard. El resto del
// front sigue sin realtime (§S8-4).
const REALTIME_ALLOWED = new Set([
  "src/features/logistics/routes/DashboardPage.tsx",
  "src/features/logistics/routes/DashboardPage.test.tsx",
]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

const violations = [];
let scanned = 0;

for await (const file of walk(SRC)) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  scanned += 1;
  const content = await readFile(file, "utf8");
  const rel = relative(process.cwd(), file).split("\\").join("/");
  const realtimeAllowed = REALTIME_ALLOWED.has(rel);
  for (const rule of RULES) {
    if (realtimeAllowed && rule.name.startsWith("canal de realtime")) continue;
    if (rule.regex.test(content)) {
      violations.push(`${rel} → ${rule.name}`);
    }
  }
}

if (violations.length > 0) {
  console.error("§S8 NEGATIVE GATE FALLÓ — alcance detectado en el front:");
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  process.exit(1);
}

console.log(`§S8 OK — 0 coincidencias en ${scanned} archivos bajo src/.`);
