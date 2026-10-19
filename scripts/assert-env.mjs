// T2.2 (tasks #510 B2) · spec DEV-03, DEV-07 · design #507 §4 filas 1-2.
// Aserción fail-fast: variables/secretos NO vacíos ANTES de cualquier paso de red o de CLI.
// Nunca confiar en el comportamiento de prompt del CLI en non-TTY (design §4 fila 1) —
// sin esta aserción, un secreto ausente produce rojos crípticos o prompts colgados.
//
// Uso: node scripts/assert-env.mjs NOMBRE_VAR [NOMBRE_VAR...]
//   · alguna vacía o indefinida → ::error por cada faltante (nombres SIEMPRE, valores NUNCA) + exit 1
//   · todas con valor           → mensaje OK (solo nombres) + exit 0
//   · sin argumentos            → usage + exit 2
// Cero dependencias — node del runner (patrón scripts/check-scope.mjs).

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error("uso: node scripts/assert-env.mjs NOMBRE_VAR [NOMBRE_VAR...]");
  process.exit(2);
}

// Escapado de anotaciones de GitHub (%, CR, LF — docs workflow commands).
const esc = (s) => String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

const missing = names.filter((name) => {
  const value = process.env[name];
  return value === undefined || value.trim() === "";
});

if (missing.length > 0) {
  for (const name of missing) {
    console.log(esc(`::error:: falta '${name}' (vacía o no definida) — configurala en GitHub Actions (Variables de repo o secrets del Environment; gates G2/T4.1). Este job falla a propósito acá: nunca corre sin ella.`));
  }
  console.error(`assert-env FALLÓ — ${missing.length} de ${names.length} valor(es) ausente(s): ${missing.join(", ")}`);
  process.exit(1);
}

// Nunca imprimir los valores (el token es el secreto más peligroso — #498 §5).
console.log(`assert-env OK — ${names.length} valor(es) presente(s): ${names.join(", ")}`);
