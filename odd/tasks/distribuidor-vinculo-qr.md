# Distribuidor: vista de ejemplo y vínculo por QR

Rama: `feat/catalogo-por-rol` · Entrega: work-unit commits en la rama actual · Runner: `npm.cmd` + `npx.cmd vitest`

## Specs

- **S1** — En `/inicio` con rol `distribuidor`, mostrar la “Vista de ejemplo” (el mismo panel visual de la landing) adaptada al distribuidor: pedidos, paradas y ruta de hoy. Los demás roles conservan el inicio actual.
- **S2** — Un operador con acceso a la tienda (fila en `user_stores`) puede obtener y regenerar el código de vínculo y desvincular distribuidores, aunque no sea el creador de la tienda.
- **S3** — Un operador sin acceso a esa tienda sigue recibiendo el mensaje amigable; `stores.link_code` sigue sin ser legible por `SELECT` directo.
- **S4** — El distribuidor sigue vinculándose escribiendo el código en `/vincular` o escaneando el QR con la cámara del celular (`/vincular/:code`); el contrato no cambia.
- **S5** — La migración nueva es re-ejecutable y queda documentada en `supabase/APLICAR-EN-PRODUCCION.md`.

## Tasks

- [x] T1 (S1) — Extraer el panel “Vista de ejemplo” a un componente compartido y renderizarlo en `/inicio` para distribuidor. Tests. → inline; `src/shared/ui/ExampleDashboard.tsx`, `LandingPage.tsx`, `HomePage.tsx`, `HomePage.test.tsx`.
- [x] T2 (S2, S3) — Migración `20261025000020_store_link_store_users.sql` + tests de contenido. Se conserva el mensaje existente (ya mapeado en `mapError`) para no ampliar el alcance. → inline; `src/test/store-link-permissions.test.ts`. Incluye `COALESCE(..., false)` para cerrar el bypass de tres valores (B1).
- [x] T3 (S4, S5) — Documentar la migración en el instructivo de producción y correr el gate completo. → `supabase/APLICAR-EN-PRODUCCION.md`, `docs/manual/USO-POR-ROL.md`; gate completo verde.

## Log

### L1 — Pedido original (2026-10-25)

> La vista de ejemplo se ve bien, puedes colocarla para el distribuidor?, ademas veo que el dsitribuidor para vincular con la tienda lo hace por un codgio que el usuario de la tienda no puede generar, puedes hacer que el usuario de la tienda pueda generar un codigo y un qr para que el distribuidor pueda usar la camara o escribir el codigo para que queden vinculados?

### L2 — Diagnóstico

- El QR y el código ya existen: `/tiendas/:storeId/qr` + RPC `get_store_link_code` / `regenerate_store_link_code` (migración 0017).
- La causa del bloqueo: `internal_can_manage_store` solo autoriza al creador (`stores.created_by`) o a un admin. Un operador asignado por `user_stores` no es creador y recibe el error.
- El escaneo con la cámara del celular ya funciona porque el QR codifica `/vincular/<code>`; no hace falta un lector embebido.
- Decisión del usuario: la “Vista de ejemplo” va en el inicio del distribuidor (`/inicio`).

### L3 — Implementación (2026-10-25)

- RED: `HomePage.test.tsx` + `store-link-permissions.test.ts` → 3 fallos, 1 pase (el inicio del operador ya era correcto).
- GREEN: 4/4. La landing conserva el mismo panel (test existente sigue verde).
- Gate completo: typecheck, lint, build OK; suite **57 archivos / 473 tests**; check-scope “§S8 OK — 0 coincidencias en 213 archivos”.
- Alcance del QR: solo cambia `internal_can_manage_store`; firmas, `GRANT`, RLS y la protección de `link_code` quedan igual. Sin lector embebido: la cámara nativa abre `/vincular/<code>`.

### L4 — Verificación pendiente y riesgo

- No hay Supabase CLI, `psql` ni DB local: el permiso no se puede ejercer en el gate. Se verificó el contenido de la migración y se dejó el diagnóstico en el instructivo; falta aplicarla en el SQL editor de Supabase y probar con un operador asignado.
- `Risk: item 2 (security/permissions)` — cambia quién puede gestionar el vínculo QR de una tienda.

### L5 — Verificación independiente (2026-10-25)

- B1 (bloqueante, corregido): con `p_store = NULL`, `NULL = ANY(...)` devolvía `NULL`; las RPC hacen `IF NOT helper` y no entraban, así que respondían éxito con un id inválido. La 0017 devolvía `false` para ese caso: era una regresión. Un id no numérico en `/tiendas/abc/qr` se serializa como `null`.
- Fix: `COALESCE(..., false)` en el helper. Cierra además A1, un hueco preexistente de 0017: un usuario inactivo/sin rol (`my_role()` NULL) también saltaba el guard. Test de regresión agregado.
- A2 corregido: el instructivo ya no dice “17 archivos”; separa lo verificado en local de 0019/0020. A4 corregido: el diagnóstico filtra por `pronamespace`.
- S2/S3/S5 siguen **sin prueba de runtime** (no hay Supabase CLI/Postgres local). Falta aplicar 0020 y probar con operador asignado, operador sin acceso, usuario inactivo, admin y dueño, incluido `p_store = NULL`.
- RDD: `review assess` devolvió `high_risk`, pero el runtime OpenCode actual no es elegible para revisión inmutable; no se inició revisión ni se inventó un PASS.
- Gate final: typecheck/lint/build OK; **57 archivos / 474 tests**; check-scope “§S8 OK — 0 coincidencias en 213 archivos”.
