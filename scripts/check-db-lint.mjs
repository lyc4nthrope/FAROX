// F3.x · schema-check paso 9 — `supabase db lint` con la superficie acotada a la app.
//
// plpgsql_check lintea TODAS las funciones de `public`, y PostGIS vive ahí (0001:9): sus
// funciones plpgsql traen errores y warnings propios (`postgis_gdal_version` ausente,
// `record not assigned`, variables muertas…) que no son superficie de la app y que 0011 no
// puede tocar. Por eso el paso excluye las funciones que pertenecen a una extensión —la
// lista se deriva en el workflow con pg_depend— y solo falla ante issues de código propio.
//
// Uso: node scripts/check-db-lint.mjs <db-lint.json> <extension-functions.txt>
// Exit: 0 = sin issues de la app · 1 = issue de la app o evidencia insuficiente · 2 = uso.

import { readFile } from "node:fs/promises";

// Issues de la app aceptados: variables muertas que plpgsql_check marca "never read variable".
// No cambian la ejecución y viven en migraciones ya aplicadas (no editables). La clave incluye
// el mensaje exacto, así que cualquier OTRO issue de la misma función sigue siendo FATAL.
const ACCEPTED_APP_ISSUES = new Map([
  [
    'public.confirm_delivery|never read variable "v_st"',
    "0004: variable muerta, sin efecto en ejecución",
  ],
  [
    'public.create_order|never read variable "v_qty"',
    "0009: variable muerta, sin efecto en ejecución",
  ],
]);

const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const die = (msg) => {
  console.error(esc(`::error::${msg}`));
  process.exit(1);
};

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("uso: node scripts/check-db-lint.mjs <db-lint.json> <extension-functions.txt>");
  process.exit(2);
}
const [lintFile, extFile] = args;

// Sin lista de exclusiones no hay forma de distinguir ruido de terceros de una regresión
// propia ⇒ fail-closed (D7: nunca verde sin evidencia).
let extRaw;
try {
  extRaw = await readFile(extFile, "utf8");
} catch (err) {
  die(
    `PARSE-MISS: no se pudo leer '${extFile}' (${err.code ?? err.message}) — sin exclusiones no se puede verificar (fail-closed)`,
  );
}
const extensionFns = new Set(
  extRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => l.split(".").pop()),
);
if (extensionFns.size === 0) {
  die(`PARSE-MISS: '${extFile}' está vacío — sin exclusiones no se puede verificar (fail-closed)`);
}

let raw;
try {
  raw = await readFile(lintFile, "utf8");
} catch (err) {
  die(`PARSE-MISS: no se pudo leer '${lintFile}' (${err.code ?? err.message})`);
}

// El CLI imprime banners ("Connecting…", "Linting schema: …") antes del array JSON.
let entries = [];
const start = raw.indexOf("[");
if (start !== -1) {
  try {
    entries = JSON.parse(raw.slice(start));
  } catch (err) {
    die(`PARSE-MISS: la salida de 'supabase db lint' no es JSON válido (${err.message})`);
  }
  if (!Array.isArray(entries)) {
    die("PARSE-MISS: la salida de 'supabase db lint' no es un array");
  }
}

const fatals = [];
const accepted = [];
let extensionIssues = 0;

for (const entry of entries) {
  const fn = typeof entry?.function === "string" ? entry.function : null;
  if (fn === null) {
    fatals.push("entrada sin campo 'function' en la salida de db lint");
    continue;
  }
  const base = fn.split(".").pop();
  for (const issue of entry.issues ?? []) {
    const level = issue?.level ?? "unknown";
    const message = issue?.message ?? "(sin mensaje)";
    if (extensionFns.has(base)) {
      extensionIssues += 1;
      continue;
    }
    const reason = ACCEPTED_APP_ISSUES.get(`${fn}|${message}`);
    if (reason !== undefined) {
      accepted.push(`[${level}] ${fn}: ${message} — ${reason}`);
      continue;
    }
    fatals.push(
      `[${level}] ${fn}: ${message}${issue?.context ? ` · ${issue.context}` : ""}`,
    );
  }
}

for (const a of accepted) console.log(esc(`::warning::app issue aceptado: ${a}`));
if (extensionIssues > 0) {
  console.log(
    esc(
      `::warning::${extensionIssues} issue(s) de funciones de extensión excluidos (PostGIS en public, 0001:9 — no es superficie de la app)`,
    ),
  );
}
for (const f of fatals) console.error(esc(`::error::db lint: ${f}`));

if (fatals.length > 0) {
  console.error(
    `DB LINT FALLÓ — ${fatals.length} issue(s) de la app, ${accepted.length} aceptado(s), ${extensionIssues} de extensión — ${lintFile}`,
  );
  process.exit(1);
}
console.log(
  `DB LINT OK — 0 issue(s) de la app, ${accepted.length} aceptado(s), ${extensionIssues} de extensión excluido(s) — ${lintFile}`,
);
