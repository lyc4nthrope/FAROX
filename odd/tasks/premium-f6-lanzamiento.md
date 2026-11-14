# FAROX — F6: lanzamiento de Premium

> **Objetivo:** dejar Premium listo para un rollout gradual y reversible, con monitoreo, runbook operativo y borradores legales revisables.
> **Rama:** `daniel`. **Entrega:** commits de unidad; sin push.
> **Runner:** `npm run test`, `typecheck`, `lint`, `check-scope`, `build`, `deno check`.
> **Plan de referencia:** `odd/tasks/premium-suscripciones-mercado-pago.md` (F6).

## Specs

- **S1. Feature flag de checkout:** el frontend usa `VITE_PREMIUM_CHECKOUT_ENABLED` (en build de producción, apagado por defecto) y la Edge Function `create-subscription` exige `PREMIUM_CHECKOUT_ENABLED=true`. Si está apagado, `/premium` muestra «Pago disponible próximamente» y la función devuelve 503; la activación manual por admin sigue funcionando.
- **S2. Canary:** `PREMIUM_CHECKOUT_ALLOWLIST` (emails separados por coma) limita el checkout a cuentas internas. Un email fuera de la lista recibe 403 amigable; el resto de la app no se bloquea. Al vaciar la lista y habilitar el flag, se abre a todos.
- **S3. Salud de pagos:** `/pagos` muestra contadores admin de pagos pendientes viejos, suscripciones pendientes viejas, avisos fallidos, usuarios en gracia y eventos de webhook de las últimas 24 h. Los valores anómalos se resaltan para que soporte actúe.
- **S4. Runbook:** `docs/runbooks/premium-lanzamiento.md` documenta precondiciones, orden de deploy, secrets, webhook de Mercado Pago, pruebas sandbox, canary, rollback, incidentes («pagué y no se activó», «cancelé y me cobraron», PSE pendiente, contracargo), monitoreo y PQR.
- **S5. Legal:** `docs/legal/premium-terminos-borrador.md` deja un borrador de términos Premium (renovación, precio, cancelación, reembolso, PQR, datos) y la Política de Privacidad menciona Mercado Pago y Resend. Ambos llevan placeholders y requieren revisión legal; no se publican como definitivos.
- **S6. Facturación/PQR:** el runbook deja explícito que DIAN/facturación electrónica, PQR con radicado y reembolsos legales requieren validación humana/contador/abogado. El código no inventa cumplimiento legal.
- **S7. Rollback:** apagar los dos flags detiene nuevos checkouts sin tocar suscripciones existentes; webhook y conciliación siguen activos para honrar pagos ya autorizados. No se borran datos.
- **S8. Tests:** flags (on/off/allowlist no testeable en frontend), salud, runbook/legal como documentos, typecheck, lint, check-scope, build y Deno check. Sin credenciales MP/Resend/DB no hay E2E.

## Tasks

| ID  | Specs     | Ruta      | Estado | Evidencia                                                                      |
| --- | --------- | --------- | ------ | ------------------------------------------------------------------------------ |
| T1  | S1-S2     | inline    | hecho  | `VITE_PREMIUM_CHECKOUT_ENABLED`, `PREMIUM_CHECKOUT_ENABLED`, allowlist y tests |
| T2  | S3        | inline    | hecho  | `fetchPremiumHealth` + tarjetas de salud en `/pagos`                           |
| T3  | S4, S6-S7 | inline    | hecho  | `docs/runbooks/premium-lanzamiento.md`                                         |
| T4  | S5        | inline    | hecho  | `docs/legal/premium-terminos-borrador.md` + privacidad MP/Resend (v1.1)        |
| T5  | S1-S8     | inline    | hecho  | tests, docs y checks                                                           |
| T6  | S1-S8     | delegated | hecho  | verificación independiente: PASS; advisories de tests/runbook corregidos       |

## Log

- **L1 (2026-11-02):** «F6». Se prepara el lanzamiento: feature flag, canary, salud, runbook y borradores legales. La revisión legal/DIAN/PQR queda como tarea humana explícita.
- **L2 (2026-11-02):** Implementado: checkout apagado por defecto en producción (`VITE_PREMIUM_CHECKOUT_ENABLED`/`PREMIUM_CHECKOUT_ENABLED`), allowlist de canary; tarjetas de salud en `/pagos`; runbook de deploy/canary/rollback/incidentes/PQR; borrador de términos Premium y privacidad con Mercado Pago/Resend (versión 1.1). No se declara cumplimiento legal ni DIAN/PQR final.
- **L3 (2026-11-02, verificación independiente):** **PASS**. Se agregaron tests del flag apagado en producción, contadores/refresh de salud, mensajes 503/403 y privacidad MP/Resend/v1.1; se corrigió el runbook para reintentar avisos fallidos y el ejemplo de secrets (checkout false hasta canary). Checks finales: 754 tests, typecheck, lint, check-scope, build y `deno check` verdes. Legal/DIAN/PQR/MP/Resend runtime siguen siendo gates humanos/externos.
- **L4 (2026-11-02):** Commit `387ef99` (`feat(premium): add launch flags, health panel and rollout docs`). El checkout queda **apagado por defecto en producción**; para canary: `PREMIUM_CHECKOUT_ENABLED=true`, `VITE_PREMIUM_CHECKOUT_ENABLED=true` y `PREMIUM_CHECKOUT_ALLOWLIST` con cuentas internas. El lanzamiento a todos requiere revisión legal/DIAN/PQR y sandbox real.
