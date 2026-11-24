# Auditoría 2026-11-18 — Lote 2: entregas e inventario

> **Objetivo:** corregir los hallazgos P1/P2 de integridad de entregas e inventario detectados en la auditoría funcional.
> **Rama:** `fix/inventario-entregas-auditoria` (desde `fix/stock-unidades-discretas`, PR #25).
> **Migración:** 0060. PR apilado sobre #25; aplicar 0058, 0059 y 0060 antes de desplegar.
> **Runner:** Vitest (`npx vitest run`); SQL: `scripts/db-test.sh` (CI/schema-check).

## Specs

- **S1.** `confirm_delivery` descuenta `distributor_products.quantity` por la cantidad recibida, con `FOR UPDATE`; rechaza la entrega si el producto no está en el catálogo o no hay stock suficiente. Marca el movimiento con `decrements_distributor_stock`.
- **S2.** `has_shortage` cuenta `received_quantity NULL` como 0 y se recalcula al confirmar la entrega. Una línea omitida en `p_items` marca el pedido como parcial.
- **S3.** `create_credit` usa `distributor_price`, luego `unit_price` y, como último fallback, el precio activo de la tienda. Si una línea recibida no tiene ningún precio, falla con mensaje claro en vez de subfacturar.
- **S4.** `update_order_status` rechaza cualquier cambio sobre un pedido `delivered` o `cancelled`.
- **S5.** `register_reverse` rechaza revertir un movimiento con `order_id`; la corrección debe hacerse desde el pedido.
- **S6.** Los mensajes nuevos tienen traducción amigable en `mapError`; tests SQL 0060 y tests unitarios de `mapError`.

## Tasks

| ID  | Specs | Ruta   | Estado    | Evidencia                                                                                                      |
| --- | ----- | ------ | --------- | -------------------------------------------------------------------------------------------------------------- |
| T1  | S1-S5 | inline | hecho     | Migración `20261124120000_entregas_inventario_auditoria.sql`                                                   |
| T2  | S6    | inline | hecho     | `supabase/tests/0060_entregas_inventario.sql`; `mapError`                                                      |
| T3  | S1-S6 | inline | pendiente | Suite completa **1006/1006**, tsc, ESLint y prettier verdes; `schema-check` pendiente en CI (sin Docker local) |

## Log

- **L1 (2026-11-24):** la auditoría funcional detectó que `confirm_delivery` no descontaba el stock del distribuidor, `has_shortage` ignoraba NULL, el fiado podía subfacturar líneas sin precio, se podía cancelar un pedido entregado y el reverso de una entrega desincronizaba pedido/stock/fiado.
- **L2 (diseño):** se mantiene el ledger de movimientos para la tienda; el distribuidor se descuenta en la misma transacción y se marca el movimiento para un futuro reverso de pedido. La edición manual de stock (INV-05) queda para un lote posterior para no mezclar un cambio de ledger con estas guardas.
- **L3 (2026-11-24):** 0060 implementa S1-S5 y los mensajes de S6. El guard de `has_shortage` y el fallback de precio de `create_credit` se prueban en `supabase/tests/0060_entregas_inventario.sql`; el CI los ejecuta con `schema-check`.
