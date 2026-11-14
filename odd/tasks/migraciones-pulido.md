# Pulido de migraciones 0040-0047

Objetivo: corregir los defectos detectados en la revisión de las migraciones no
aplicadas y reducir el egreso (filas y eventos realtime) sin cambiar la API
pública de las RPC. Rama `daniel`. Runner `npm run ci`.

## Specs

- **S1.** `0046` no debe congelar los costos aprendidos del distribuidor: el
  backfill distingue `movement` (hay una compra con ese `unit_cost`) de `manual`.
- **S2.** El precio de venta sugerido solo se publica en movimientos que son
  reabastecimiento (`register_entry`) o venta (`register_exit`). Merma, ajuste y
  devolución no tocan precios (invariante ya escrito en `0044`).
- **S3.** En `confirm_delivery` el Premium que habilita escribir precios de la
  tienda es el del **dueño de la tienda** (`stores.created_by`), no el del
  distribuidor que entrega.
- **S4.** Los lotes bloquean filas en orden de `product_id` (anti-deadlock), igual
  que `confirm_delivery`.
- **S5.** `set_store_prices_bulk` valida el lote con una consulta, no con una por
  línea, y reporta `product_id` ausente con un error propio.
- **S6.** `normalize_phone_e164` respeta el `+` explícito y acepta fijos
  colombianos `60x`; rechaza 10 dígitos sin prefijo que no sean Colombia.
- **S7.** `users.phone_number` se guarda normalizado en toda escritura y un
  cambio de número borra la verificación en el mismo trigger.
- **S8.** Egreso: el cliente no puede leer `chat_messages.payload` (hasta 16 KB
  por fila); el rate limit cuenta por `created_at`, no por conversación.
- **S9.** Un ticket de movimientos hace UN upsert de `dashboard_daily` (un evento
  realtime), no uno por línea.
- **S10.** Funciones internas nuevas sin `EXECUTE` para `anon`/`authenticated`.

## Tasks

- [x] T1 — `0043`: validación por lote + orden de bloqueo.
- [x] T2 — `0044`: orden de bloqueo en el ticket.
- [x] T3 — `0046`: backfill, motivo, Premium del dueño, orden de bloqueo.
- [x] T4 — `0047`: orden de bloqueo + origen del costo.
- [x] T5 — `0048`: normalización de teléfono, egreso de chat, dashboard
      agregado, privilegios internos.

Evidencia: `npm run test` 908/908, `npm run typecheck` limpio.
`src/test/pulido-egreso.test.ts` fija el contrato de 0048 y de las correcciones
de 0043/0046/0047.

## Log

### L1 — pedido (verbatim)

> No, quiero que hagas las correcciones del SQL de las ultimas 5 migraciones, y
> si algo prepares una nueva migracion para agreglar o pulir anteiores. Un cosa
> importante, es la cantidad de informacion que se consulta, ya que se quiere
> optimizar el egres usado.

### L2 — decisión (2026-11-08)

Solo se editan `0043`-`0047` (no aplicadas ni versionadas). Todo lo que toca
`0040`-`0042` y el esquema anterior va en `0048`, respetando el append-only.
Las definiciones efectivas de `register_entry`, `confirm_delivery`,
`register_distributor_purchases`, `set_store_prices_bulk` y
`update_store_product_full` viven en `0046`; los cuerpos de `0045` quedan
superados por diseño y no se reescriben.

Egreso medido: el cliente ya usa listas de columnas explícitas
(`products/api.ts:47-53`, catálogo en `704-825`). Los dos vectores reales son
`chat_messages.payload` (sin filtro de columna) y el upsert por línea de
`dashboard_daily` (1 evento realtime por línea).
