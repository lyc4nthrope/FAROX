# Inventario unificado y solicitud sin precio

Objetivo: unificar Productos dentro de Inventario y permitir que el operador solicite productos sin precio previo, dejando que el distribuidor cotice. Rama `daniel` (actualizada desde `main`). Runner: `vitest` (`npm run test`).

## Specs

- **S1.** Inventario es la vista principal de la tienda: «la principal seria inventario y productos ya seria la asignacion de los productos a cada tienda que posee el usuario». El operador pierde la ruta `/products` (redirige a `/inventario`) y su entrada de navegación «Productos».
- **S2.** En `/inventario/:storeId`, la pestaña «Productos» reúne el catálogo y la asignación de esa tienda: buscar por nombre, filtrar por categoría y «solo faltantes», editar cantidad, editar umbral, ver vencimiento y estado, marcar/quitar faltante, quitar del catálogo y «Agregar productos» desde el registro (con alta rápida).
- **S3.** El operador puede «solicitar el producto y cantidad sin necesidad de asignar precio». `create_order` deja de exigir `price_publications` activa para el operador y la línea queda con `unit_price` NULL.
- **S4.** «ya el dsitrbuidor tomaria la solicitud y ahi tal vez marque cuanto le cobrara al operador»: el distribuidor dueño del pedido puede fijar el precio de cotización de cada línea (`order_items.distributor_price`) mientras el pedido está `pending` (RPC `set_order_prices`) y verlo en el detalle. La cotización alimenta el fiado y el valor del movimiento (`COALESCE(distributor_price, unit_price)`). `unit_price` sigue siendo el precio privado de la tienda y `get_order_items` no lo expone (D40/D41).
- **S5.** Sin cambios para el admin: su catálogo global sigue en `/products` y `create_order` sigue exigiendo precio activo cuando quien pide es admin.
- **S6.** La UI de `/pedidos/nuevo` del operador ya no deshabilita productos sin precio ni muestra el aviso «Publicá su precio en Inventario»; los faltantes se preseleccionan aunque no tengan precio.

Supuestos:

- La solicitud reutiliza la entidad `orders` en estado `pending`; no se crea una entidad nueva.
- La cotización se modela en una columna propia (`distributor_price`) para no reutilizar `unit_price`, que es el precio privado de la tienda (D40/D41); el distribuidor no lo ve.
- La visibilidad de precios para no-premium se mantiene: la cotización se muestra al admin, al distribuidor del pedido y al operador Premium de la tienda.
- La limpieza de umbral necesita una RPC propia (`set_stock_threshold`) porque `assign_product_to_store` no borra umbrales existentes.

## Tasks

| ID | Spec | Ruta | Estado | Evidencia |
|----|------|------|--------|-----------|
| T1 | S1 | inline | hecho | rama `daniel` ff a `main`; commit `bc4f433` (selector de productos) |
| T2 | S3-S5 | inline | hecho | migración 0024: `create_order`, `order_items.unit_price` nullable, `distributor_price`, `get_order_quotes`, `set_order_prices`, `create_credit`, `confirm_delivery`, `set_stock_threshold` |
| T3 | S1-S2 | inline | hecho | `StoreCatalogPanel` + `ThresholdEditor` + `setStoreProductThreshold`; `StoreCatalogPanel.test` 8 casos |
| T4 | S1-S2 | inline | hecho | `InventoryPage` compone el panel; pestaña inicial «Productos»; nav del operador sin `/products`; redirección en `ProductsPage` |
| T5 | S3-S6 | inline | hecho | `NewOrderPage` sin bloqueo ni aviso por precio; faltantes se precargan completos |
| T6 | S4 | inline | hecho | caja «Cotización del distribuidor» en `OrderDetailPage` + `fetchOrderQuotes`/`setOrderPrices` |
| T7 | S1-S6 | inline | hecho | `npm run typecheck`, `lint`, `check-scope` y `test` (606 tests) en verde; `APLICAR-EN-PRODUCCION.md` y manual actualizados |

## Log

- **L1 (2026-10-26):** «Muevete a la rama daniel y fusiona la vista de productos e inventario, ya que parecen lo mismo y se podrian hacer la acciones en ese lugar, por ejemplo la principal seria inventario y prodcutos ya seria la asignacion de los productos a cada tienda que posee el usuario. Ademas, cuando un operador quiere solicitar productos a un distribuidor dice que si o si necesita tener un "movimiento" (que el producto tenga registrado el precio pero esa acciones es limitada a premium), asi que deberia poder solicitar el producto y cantidad sin necesidad de asignar precio, ya el dsitrbuidor tomaria la solicitud y ahi tal vez marque cuanto le cobrara al operador.»
- **L2:** `daniel` estaba 28 commits detrás de `main` y era su ancestro: se movió con `git checkout -B daniel main` (sin pérdida) y se preservó el trabajo pendiente del selector de productos.
- **L3 (diseño):** se descartó reutilizar `unit_price` para la cotización: ese campo es el precio privado de la tienda y exponerlo al distribuidor habría roto D40/D41. `distributor_price` + `get_order_quotes` mantienen la separación. `confirm_delivery` se actualizó a `COALESCE(distributor_price, unit_price)` y a `COALESCE(..., 0)` para no violar el NOT NULL de `dashboard_daily.entries_value`.
- **L4 (verificación):** la migración 0024 **no se ejecutó contra un Postgres real** (el entorno no tiene Supabase CLI/Docker/psql); queda pendiente aplicarla en el SQL editor y correr el diagnóstico de `supabase/APLICAR-EN-PRODUCCION.md`.
