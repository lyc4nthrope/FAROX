# Recuperar contraseña con email

Rama: `feat/catalogo-por-rol` · Entrega: cambios sin commit (el usuario no lo pidió) · Runner: `npm.cmd` + `npx.cmd vitest`

## Specs

- **S1** — En `/login`, un enlace “¿Olvidaste tu contraseña?” lleva a `/recuperar`.
- **S2** — `/recuperar` es pública: valida el email con zod antes de cualquier request; llama a `resetPasswordForEmail` con `redirectTo: ${origin}/restablecer`; ante éxito muestra un mensaje genérico (“Si el email está registrado…”) para no revelar si la cuenta existe; los errores de rate limit/red se muestran amigables y el texto crudo del backend nunca llega al DOM.
- **S3** — `/restablecer` es pública y acepta el link del email: canjea el `code` PKCE o usa la sesión implícita ya creada; sin sesión muestra “link inválido o expirado” con salida a `/recuperar`; con sesión muestra el formulario de nueva contraseña.
- **S4** — La nueva contraseña exige mínimo 6 caracteres y coincidencia con la confirmación antes de cualquier request; `updatePassword` llama a `updateUser({ password })`; los errores `weak_password`, `same_password` y sesión expirada se traducen a mensajes amigables; el éxito muestra “Contraseña actualizada” con salida a `/inicio`.
- **S5** — `/recuperar` y `/restablecer` quedan fuera de `RequireAuth`/`AppShell`; login, registro, callback y guards existentes no cambian de comportamiento. El instructivo de producción documenta la Redirect URL `/restablecer` y el template de recuperación.

## Tasks

- [x] T1 (S2, S3, S4) — Schemas, API (`requestPasswordReset`, `updatePassword`, `establishRecoverySession`) y tests de contrato. → inline; `api.test.ts`, `schemas.test.ts` (23 tests).
- [x] T2 (S1, S2, S3, S4, S5) — Formularios, páginas, rutas públicas, enlace en login y tests de UI. → inline; `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, forms, `router.tsx`, `LoginPage.tsx`; tests de UI + router (incluye la regresión de `same_password`).
- [x] T3 (S5) — Documentar la configuración de Supabase y correr el gate completo. → `APLICAR-EN-PRODUCCION.md` (Redirect URL + template “Reset Password”), `USO-POR-ROL.md`; gate completo verde.

## Log

### L1 — Pedido original (2026-10-25)

> Puedes agregar la opcion de olvide mi contaseña?, para poder cambiarla con el email.

### L2 — Diagnóstico y decisiones

- Hoy no existe ningún flujo de recuperación: `api.ts` solo tiene login, registro, reenvío de confirmación y canje del callback.
- Supabase ya ofrece el mecanismo: `resetPasswordForEmail(email, { redirectTo })` envía el link; al volver, la sesión de recuperación permite `updateUser({ password })`.
- El cliente actual usa el flujo implícito (no fija `flowType`), pero `confirmEmailConfirmationCode()` ya cubre ambos: canjea `?code=` (PKCE) o acepta la sesión ya creada (implícito). Se reutiliza para no duplicar esa lógica.
- Rutas elegidas: `/recuperar` (pedir email) y `/restablecer` (elegir contraseña), en español como el resto de la app.
- Anti-enumeración: el éxito de `/recuperar` es siempre genérico; el rate limit se muestra como “esperá unos minutos”, sin afirmar si el email existe.
- Requisito de producción: agregar `https://<dominio>/restablecer` a las Redirect URLs de Supabase Auth; sin eso el link vuelve al Site URL y el flujo no abre la pantalla correcta.

### L3 — Implementación (2026-10-25)

- RED: `api.test.ts` + `schemas.test.ts` fallaron por exports inexistentes (13 fallos) y las páginas por módulos inexistentes; después GREEN.
- T1: `requestPasswordReset` usa `redirectTo: ${origin}/restablecer`; `updatePassword` llama a `updateUser({ password })`; `establishRecoverySession` reutiliza el canje PKCE/sesión implícita existente.
- T2: `/login` tiene “¿Olvidaste tu contraseña?”; `/recuperar` valida email, pide el link y muestra un mensaje genérico; `/restablecer` canjea el link, pide nueva contraseña + confirmación y muestra “Contraseña actualizada”. Ambas rutas son públicas.
- T3: documentadas la Redirect URL `/restablecer` y el flujo manual.
- Gate: `npx.cmd vitest run src/features/auth src/app/router.test.tsx` → 8 archivos / 93 tests; falta el gate completo tras la documentación.
- `Risk: item 2 (security/auth)` — agrega recuperación de cuenta por email y cambia la superficie pública de auth.

### L4 — Verificación independiente y corrección (2026-10-25)

- Verificador independiente: S1, S2 y S3 PASS; S4 y S5 FAIL por dos hallazgos.
- Blocker corregido: `resetPasswordErrorMessage` evaluaba `password should` antes que `same_password`, y el mensaje canónico de GoTrue (“New password should be different from the old password.”) caía en “requisitos mínimos”. RED con un 8.º test en `ResetPasswordPage.test.tsx`, luego GREEN; ahora `same_password` se evalúa primero y la rama débil cubre `weak_password`, `password should`, `too weak` y `password is weak`.
- Gap S5 corregido: `APLICAR-EN-PRODUCCION.md` ahora documenta el template “Reset Password” (`{{ .ConfirmationURL }}`) y la Redirect URL local, además de la de producción.
- Advisory aceptado: cualquier sesión autenticada previa habilita `/restablecer` porque `establishRecoverySession` cae a `getSession()`. Solo afecta a la propia cuenta, `updateUser` exige sesión y S3 permite “con sesión muestra el formulario”; no hay escalada de privilegios.
- UNVERIFIED (sin Supabase runtime): entrega real del email, allowlist de Redirect URLs, evento `PASSWORD_RECOVERY`/hash implícito y timing de enumeración de cuentas.
- Gate completo: `typecheck` 0, `lint` 0, 60 archivos / 503 tests, `check-scope` 0 coincidencias en 220 archivos, `build` OK.
