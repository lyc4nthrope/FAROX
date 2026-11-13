# FAROX — Premium F1: estado por vencimiento, planes versionados y desglose

> **Objetivo:** sentar la base de datos y la UI de estado para Premium pagado, sin integrar aún Mercado Pago.
> **Rama:** `daniel` (rama de trabajo actual). **Entrega:** commits de unidad de trabajo, sin push.
> **Runner:** `npm run test`, `npm run typecheck`, `npm run lint`, `npm run check-scope`, `npm run build`.
> **Plan de referencia:** `odd/tasks/premium-suscripciones-mercado-pago.md` (F1).

## Specs

- **S1.** «Si» (confirmación del plan): el precio final sigue siendo 10.000 COP/mes y 100.000 COP/año; el desglose es informativo (IVA incluido y comisión de Mercado Pago descontada del recaudo, no sumada al precio). El precio es editable por el admin y los suscriptores existentes conservan su precio.
- **S2.** `users.premium` sigue siendo el grant manual/indefinido; se agrega `users.premium_until` para la vigencia pagada y `users.premium_grace_until` para la ventana de elección de tienda (7 días).
- **S3.** `is_premium()` debe ser verdadero para admin, o para `users.premium = true` con `premium_until` NULL o futuro; falso cuando la fecha ya pasó. No se puede activar Premium desde el cliente.
- **S4.** `set_user_premium` sigue siendo solo admin: `true` = grant manual indefinido; `false` = revoca el grant manual y arranca la gracia de 7 días.
- **S5.** `plans` guarda precio final, IVA, comisión de Mercado Pago (porcentaje + fijo + IVA de la comisión), `fee_passed_to_customer` (por ahora absorbida), intervalo y estado. `plan_versions` guarda cada cambio con autor y fecha.
- **S6.** `quote_plan(p_code)` devuelve el desglose server-side: `final_cents`, `base_cents`, `tax_cents`, `mp_fee_cents`, `net_cents`, moneda e intervalo. La UI no calcula el monto a cobrar.
- **S7.** `update_plan_pricing` es solo admin, valida rangos y crea una versión nueva; no hay precios hardcodeados en el frontend.
- **S8.** `subscriptions`, `payments` y `payment_events` existen con RLS: el usuario solo lee lo propio, el admin todo; nadie escribe desde el cliente; las Edge Functions usarán `service_role` en F4.
- **S9.** `activate_premium` es la única vía de activación pagada: idempotente por pago, extiende `premium_until` y limpia la gracia. En F1 se prueba con un pago manual de laboratorio; F4 la usará desde el webhook.
- **S10.** `my_premium_status()` devuelve `premium`, `premium_until`, `premium_grace_until`, `grace_active`, `needs_store_choice` y `active_owned_stores` para el perfil y el futuro modal de downgrade.
- **S11.** El perfil muestra el plan actual: «Gratis», «Premium hasta X» o «Premium manual»; el badge del shell sigue leyendo `is_premium()`. Un job diario sincroniza `users.premium` con `premium_until` para que el listado admin no muestre Premium vencido.
- **S12.** Los `users.premium = true` existentes quedan como grant manual (`premium_until = NULL`); no se cobran ni se vencen.

## Tasks

| ID  | Specs          | Ruta   | Estado | Evidencia                                                                                        |
| --- | -------------- | ------ | ------ | ------------------------------------------------------------------------------------------------ |
| T1  | S2-S5, S8, S12 | inline | hecho  | migración 0032: columnas, tablas, seed de planes, RLS                                            |
| T2  | S3-S4, S9-S10  | inline | hecho  | `is_premium`, `set_user_premium`, `activate_premium`, `my_premium_status`, job de sincronización |
| T3  | S5-S7          | inline | hecho  | `quote_plan`, `update_plan_pricing`, tests de contrato/matemática en `premium/api.test.ts`       |
| T4  | S11            | inline | hecho  | `PremiumStatusCard` en `/profile`; API premium; `refreshPrivileges` ya existía                   |
| T5  | S1-S12         | inline | hecho  | typecheck, lint, check-scope, 679 tests y build en verde; docs/APLICAR actualizados              |

## Log

- **L1 (2026-11-01):** «Si» — confirmación para arrancar F1 con el desglose informativo (10.000 final, IVA incluido, comisión MP descontada) y grandfathering de suscriptores existentes. Referencia: `odd/tasks/premium-suscripciones-mercado-pago.md`.
- **L2 (2026-11-01):** F1 implementado: migración 0032, `is_premium` con fecha, `set_user_premium` manual, `activate_premium` idempotente, `my_premium_status`, `quote_plan`, `update_plan_pricing`, job diario y tarjeta de plan en el perfil. 679 tests, typecheck, lint, check-scope y build en verde. La migración no se ejecutó contra Postgres.
- **L3 (verificador 0032):** bloqueadores corregidos: (a) `quote_plan` multiplica en `numeric` para que el plan anual no desborde int4; (b) la policy `plans_select_anon` ya no llama `my_role()` desde anon; (c) la gracia solo se deriva cuando no hay Premium activo y `needs_store_choice` espera a que termine la gracia; (d) `set_user_premium(false)` rechaza cortar un período pago vigente; (e) `activate_premium` usa `p_payment_id`; (f) el diagnóstico de APLICAR no consulta `plans` si la tabla no existe. Se agregó `migration.test.ts` con guardas estáticas. `typecheck`, `lint`, `check-scope`, 684 tests y `build` en verde. 0032 sigue sin ejecutarse contra Postgres.
- **L4 (recheck 0032):** B1/B2/B3 y A1/A3/A4 cerrados. Se agregó `DROP FUNCTION IF EXISTS activate_premium` para que un re-run sobre una 0032 vieja no falle al cambiar el nombre del parámetro; `0012` H4.2 excluye la policy pública intencional `plans_select_anon`; APLICAR verifica los dos planes sembrados. Se agregó el mapeo amigable de «período pago vigente». `typecheck`, `lint`, `check-scope`, 685 tests y `build` en verde.
