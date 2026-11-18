# Fiado del distribuidor y entrega parcial visible

> **Objetivo:** el distribuidor acreedor puede crear el fiado de su pedido entregado y la entrega parcial queda visible en la lista y el detalle.
> **Rama:** `fix/fiado-distribuidor-entrega-parcial` (desde `main` dee44a3).
> **Migración:** 0058. Aplicar antes de desplegar el front que muestra esta feature.
> **Runner:** Vitest (`npx vitest run`); SQL: `scripts/db-test.sh` (CI/schema-check).

## Specs

- **S1.** `orders.has_shortage` persiste si una entrega fue parcial (alguna línea `received_quantity < quantity`). Un trigger sobre `order_items` la mantiene; el backfill cubre pedidos entregados existentes.
- **S2.** `create_credit` acepta `admin`, `operador` de la tienda y `distribuidor` dueño del pedido. El total sigue saliendo de `received_quantity`; las policies de lectura ya incluyen al distribuidor (0054).
- **S3.** La lista de pedidos muestra un badge **“Parcial”** para ambos roles y un acceso **“Fiar”** en pedidos entregados. El acceso lleva al detalle, donde está el formulario con vencimiento.
- **S4.** El detalle muestra **“Entrega parcial”** y habilita el box **Fiado** para admin, operador y distribuidor acreedor.
- **S5.** Se reutilizan `OrderActions`, `OrdersPage`, `OrderDetailPage`, `CreditsPage` y `createCredit`; no se crean tablas nuevas.
- **S6.** Tests SQL de rol/alcance y del flag; tests Vitest de lista/detalle; suite completa.

## Tasks

| ID  | Specs | Ruta   | Estado | Evidencia                                                                                                                                                                                                                  |
| --- | ----- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S1-S2 | inline | hecho  | Migración `20261118120000_fiado_distribuidor_y_entrega_parcial.sql` + `supabase/tests/0058_fiado_distribuidor.sql`                                                                                                         |
| T2  | S3-S4 | inline | hecho  | `OrdersPage` badge/acción; `OrderDetailPage` box para distribuidor; `has_shortage` en `OrderRow`                                                                                                                           |
| T3  | S5    | inline | hecho  | Reutiliza componentes y `createCredit`; sin tablas nuevas                                                                                                                                                                  |
| T4  | S6    | inline | hecho  | Suite front 999/999 y tsc en verde; `schema-check` verde con las pruebas SQL 0054/0058. `quality` solo falla por el `npm audit` que corrige #22. 0054 T5 alineado: el distribuidor crea el fiado propio y no toca el ajeno |

## Log

- **L1 (2026-11-18):** «Si, ademas debia incluir al distribuidor, reusando lo mas posible. Aunque creo yo, que es necesario un analisis mas extenso.»
- **L2 (2026-11-18):** El operador reportó que no veía el registro de una entrega parcial ni una opción de fiado. Producción confirma que `order_items.received_quantity`, los movimientos `entry` y los precios **sí** están; la brecha principal era de UI. Esta tarea agrega la marca persistente y el acceso al fiado, y habilita al distribuidor acreedor.
- **L3 (diseño):** el flag se mantiene con un trigger sobre `order_items` para no recalcular items al listar. El fiado se crea desde el detalle (fecha de vencimiento opcional); la lista solo enlaza. Registrar pagos sigue siendo de la tienda/admin; el distribuidor lee el crédito y sus pagos.
- **L4 (2026-11-18):** PR #24. `schema-check` pasó tras corregir el estado `delivered` del fixture 0054 (el enum solo admite `pending/received/partial`); `quality` queda pendiente del gate de auditoría de #22. La 0059 del stock se apila sobre esta rama en el PR #25.
