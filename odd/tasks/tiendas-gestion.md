# FAROX — F3.5: gestión de tiendas (editar, desactivar, reactivar, transferir)

> **Objetivo:** que el dueño pueda editar o desactivar una tienda sin perder datos, y que el admin pueda transferir la propiedad cuando la tienda cambia de dueño.
> **Rama:** `daniel`. **Entrega:** commits de unidad; sin push.
> **Runner:** `npm run test`, `typecheck`, `lint`, `check-scope`, `build`.
> **Plan de referencia:** `odd/tasks/premium-suscripciones-mercado-pago.md` (§11).

## Specs

- **S1.** El dueño (`stores.created_by`) o un admin puede editar nombre, dirección, ciudad, teléfono y tipo desde `/stores/:id`; los datos operativos (stock, pedidos, rutas, créditos) no se tocan.
- **S2.** El dueño puede desactivar su tienda desde el formulario. Es un soft-delete: `is_active=false`, `deactivated_reason='user_removed'`, `deactivated_at=now()`; no borra stock, pedidos, rutas ni créditos. Si hay pedidos en `pending` o `in_route`, la RPC falla con un mensaje que pide entregarlos o cancelarlos; el admin puede forzar con `p_force=true` (la UI no lo envía).
- **S3.** Una tienda desactivada por el dueño (`user_removed`) se puede reactivar desde **Perfil → Gestionar mis tiendas**; una desactivada por el admin, una `premium_expired` sin Premium o una inactiva legacy sin razón (`NULL`) solo la reactiva un admin desde el formulario. Reactivar limpia `deactivated_reason` y `deactivated_at`. El tope de tiendas (1 free, 3 Premium) se sigue validando en la base; las reactivaciones concurrentes se serializan con el lock por usuario de 0033.
- **S4.** El admin puede transferir la propiedad a otro operador/admin activo desde la ficha de la tienda. La RPC actualiza `stores.created_by` y mueve `user_stores`; el dueño anterior pierde el acceso. Se rechazan distribuidores, usuarios inactivos y el mismo dueño. Si la tienda está activa, el nuevo dueño debe tener cupo (1 free, 3 Premium; admin exento).
- **S5.** `deactivate_store`, `reactivate_store` y `transfer_store` son `SECURITY DEFINER` con `search_path` fijo y `REVOKE` de `PUBLIC`/`anon`; solo `authenticated` y `service_role` ejecutan. `user_is_premium(uuid)` queda interna. El dueño no puede desactivar/reactivar tiendas ajenas; un operador sin rol admin no puede transferir. El UPDATE directo de `stores` queda acotado a columnas de edición: `created_by`, `is_active` y `deactivated_*` solo cambian por RPC.
- **S6.** No se expone borrado duro en la UI. La purga admin-only de una tienda ya inactiva queda como deuda separada; esta fase preserva datos y auditoría (`audit_log` vía trigger de `stores`).
- **S7.** Tests de la migración, de la API/UI de desactivación, del panel de transferencia y de la reactivación del dueño; documentación en `docs/manual/USO-POR-ROL.md` y pasos de verificación en `supabase/APLICAR-EN-PRODUCCION.md`.

## Tasks

| ID | Specs | Ruta | Estado | Evidencia |
|---|---|---|---|---|
| T1 | S2, S5, S6 | inline | hecho | `20261029000034_gestion_tiendas.sql`: `deactivate_store`, guard de pedidos abiertos, soft-delete con razón, grants |
| T2 | S3, S4, S5 | inline | hecho | migración: `reactivate_store`, `transfer_store`, `user_is_premium`, locks por usuario, cap 1/3, `user_stores` |
| T3 | S1, S2, S3 | inline | hecho | `StoreFormPage`: dueño/admin ven «Desactivar tienda»; confirmación; reactivación del dueño en `PremiumStoresPage`; banner admin limpia razón |
| T4 | S4 | inline | hecho | `TransferStorePanel` + `transferStore`; solo operadores/admin activos distintos del dueño |
| T5 | S1-S7 | inline | hecho | tests de migración/UI, manual, `APLICAR-EN-PRODUCCION.md`, typecheck/lint/check-scope/test/build |

## Log

- **L1 (2026-11-02):** «Si, ademas puedes anotar que se deberia poder editar o eliminar una tienda (dado el caso que una tienda ya no sea de su propiedad o por cuestiones cambien de nombre o solo tenga menos tiendas).» Se anotó el backlog en F3 y se implementa en F3.5.
- **L2 (2026-11-02):** «Sigue con 3.5». Se implementan edición (ya soportada por RLS), desactivación por el dueño, reactivación y transferencia admin. La migración 0034 aún no se aplicó contra Postgres; los pasos quedan en `supabase/APLICAR-EN-PRODUCCION.md`.
- **L3 (2026-11-02):** Se agregan locks por usuario a `reactivate_store`/`transfer_store` para serializar el tope con 0033, y se expone la reactivación de `user_removed` en `/premium/tiendas`. El banner admin de tiendas limpia la razón de desactivación.
- **L4 (2026-11-02, verificación independiente):** Blocker corregido: `v_reason NOT IN ('user_removed')` era NULL-unsafe y permitía al dueño reactivar una tienda inactiva legacy sin razón; ahora usa `IS DISTINCT FROM`. Se acota el UPDATE directo de `stores` a columnas de edición (evita saltarse los guards con un PATCH a `is_active`), se ordena el lock de `transfer_store` después del row lock para evitar deadlocks y se resetea `storeOwner` al cambiar de tienda.
- **L5 (2026-11-02):** Commit `32b8e34` (`feat(stores): add owner deactivation and admin transfer`). Verificación independiente final: PASS; 715 tests, typecheck, lint, check-scope y build en verde. Migración 0034 pendiente de aplicar contra Postgres.
