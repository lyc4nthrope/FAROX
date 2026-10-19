// T2.1 (tasks #510 B2) · spec DEV-09 · design #507 §2.6 (severity map) + D7 (presence-then-count).
// Parser de la salida de verificación de migraciones (psql NOTICE/WARNING), cero dependencias,
// corre con el node del runner (#510 T2.1: "zero deps, runner node"; patrón scripts/check-scope.mjs).
//
// Fuentes de verdad de los patrones (leídas en repo 2026-10-19, NO inventadas):
//   · [FAIL] individual   → 20261016000012_verify_hardening.sql:93   (RAISE WARNING '0012 % % [FAIL] — %')
//   · RESUMEN con conteo  → idem :1371-1372  (RAISE NOTICE '0012 RESUMEN — total: % · OK: % · FAIL: % · WARNING: % · SKIP: %')
//   · resumen fallido     → idem :1373-1374  (IF v_fail > 0 → RAISE WARNING '0012 — % check(s) FAIL: …')  ← spec cita :1371-1377
//   · camino sano         → idem :1375-1376  (RAISE NOTICE '0012 — sin FAIL: …')
//   · V10 sin admin       → 20261015000008_verify.sql:397  (ACK no-fatal mientras F34_ADMIN_ASSERT esté unset — design §2.6)
//   · psql ERROR:         → cualquier línea de nivel ERROR (design §2.6: FATAL)
//   · PARSE-MISS (D7)     → presencia PRIMERO: sin '0012 RESUMEN' (o sin evidencia de aplicación en
//                           modo apply / sin salida de 0008 en modo verify) ⇒ exit 1 aunque "0 FAILs".
// '[' en '[FAIL]' es exclusivo de 0012 (grep verificado sobre las 12 migraciones) ⇒ sin falsos positivos.
//
// Salida: ::error:: por cada FATAL/PARSE-MISS, ::warning:: por cada WARNING ACK, resumen por consola.
// Exit: 0 = sano · 1 = FATAL o PARSE-MISS o log ilegible · 2 = uso incorrecto.
//
// Uso: node scripts/parse-verify-output.mjs [--expect=apply|verify] <log>
//   apply (default): salida capturada de `supabase db start` en stack fresco (schema-check, DEV-08/09).
//   verify:          salida de 0008+0012 sobre BD restaurada (drill de backup, DEV-12).

import { readFile } from "node:fs/promises";

// Las 12 migraciones del repo (glob supabase/migrations/ 2026-10-19) — evidencia de aplicación.
const MIGRATION_VERSIONS = [
  "20261015000001", "20261015000002", "20261015000003", "20261015000004",
  "20261015000005", "20261015000006", "20261015000007", "20261015000008",
  "20261016000009", "20261016000010", "20261016000011", "20261016000012",
];

// Escapado de anotaciones de GitHub (%, CR, LF — docs workflow commands).
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

// ---------------------------------------------------------------- CLI ---
let expect = "apply";
let file = null;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--expect=")) {
    expect = arg.slice("--expect=".length);
  } else if (arg.startsWith("-")) {
    console.error(esc(`::error::parse-verify-output: flag desconocido '${arg}'`));
    process.exit(2);
  } else if (file === null) {
    file = arg;
  } else {
    console.error(esc(`::error::parse-verify-output: argumento extra '${arg}'`));
    process.exit(2);
  }
}
if (file === null || (expect !== "apply" && expect !== "verify")) {
  console.error("uso: node scripts/parse-verify-output.mjs [--expect=apply|verify] <log>");
  process.exit(2);
}

// ------------------------------------------------------- lectura del log ---
// Log ausente/ilegible = rojo por default (D7: nunca verde sin evidencia).
let raw;
try {
  raw = await readFile(file, "utf8");
} catch (err) {
  console.error(esc(`::error::PARSE-MISS: no se pudo leer el log '${file}' (${err.code ?? err.message}) — sin log no hay verificación (D7)`));
  process.exit(1);
}

const lines = raw.split(/\r?\n/);
const fatals = [];
const warns = [];

// ------------------------------------------- 1) PRESENCIA (D7: primero presencia) ---
const resumenLine = lines.find((l) => l.includes("0012 RESUMEN"));
const applyLines = lines.filter((l) => MIGRATION_VERSIONS.some((v) => l.includes(v)));
const hasVerify0008 = lines.some((l) => /V\d+ (OK|—)/.test(l));

if (resumenLine === undefined) {
  fatals.push("PARSE-MISS: falta la línea '0012 RESUMEN' — el 0012 no corrió o el formato de salida cambió (design #507 §2.6: parse-miss = FATAL, §4 fila 12)");
}
if (expect === "apply" && applyLines.length === 0) {
  fatals.push("PARSE-MISS: ninguna línea de aplicación de migraciones en la salida — la BD fresca no aplicó las 12 (DEV-08). Si db start no aplica migraciones en esta versión del CLI, escalar: design #507 §6.2 contempla supabase start -x como forma alternativa.");
}
if (expect === "verify" && !hasVerify0008) {
  fatals.push("PARSE-MISS: falta salida de verificación de 0008 (marcadores 'V… OK'/'V… —') — el drill no evidencia los dos scripts exigidos (DEV-12)");
}

// ------------------------------------- 2) CONTEO de FATALES (severity map §2.6) ---
const isFatalLine = (l) => /\[FAIL\]/.test(l) || /check\(s\) FAIL/.test(l) || /\bERROR:\s/.test(l);
for (const line of lines) {
  if (/\[FAIL\]/.test(line)) {
    fatals.push(`[FAIL] 0012 (verificado :93): ${line.trim()}`);
  } else if (/check\(s\) FAIL/.test(line)) {
    fatals.push(`resumen 0012 con FAILs (verificado :1374): ${line.trim()}`);
  } else if (/\bERROR:\s/.test(line)) {
    fatals.push(`psql ERROR: ${line.trim()}`);
  }
}
if (resumenLine !== undefined) {
  const m = resumenLine.match(/FAIL: (\d+)/);
  if (m !== null && Number(m[1]) > 0) {
    fatals.push(`RESUMEN 0012 con FAIL=${m[1]} > 0 (conteo, verificado :1371-1374 ⇒ FATAL)`);
  }
}

// ------------------------------------- 3) ACK / warnings no-fatales (§2.6) ---
for (const line of lines) {
  if (!/^\s*WARNING:/.test(line)) continue;
  if (isFatalLine(line)) continue; // ya clasificados como FATAL arriba
  if (line.includes("V10 — SIN ADMIN ACTIVO")) {
    warns.push(`V10 sin admin activo (esperado en stack fresco / mientras F34_ADMIN_ASSERT esté unset — G5 pendiente): ${line.trim()}`);
  } else {
    warns.push(`WARNING psql no clasificado (revisar en el primer run y promover a FATAL si corresponde — design §2.6): ${line.trim()}`);
  }
}

// ------------------------------------------------------------ 4) reporte ---
for (const w of warns) console.log(esc(`::warning::${w}`));
for (const f of fatals) console.error(esc(`::error::${f}`));

if (fatals.length > 0) {
  console.error(`PARSEO FALLÓ — ${fatals.length} FATAL/PARSE-MISS, ${warns.length} warning(s) ACK — ${file} [expect=${expect}]`);
  process.exit(1);
}
console.log(`PARSEO OK — presencia confirmada, FAIL=0, ${warns.length} warning(s) ACK — ${file} [expect=${expect}]`);
