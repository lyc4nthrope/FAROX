# Stock por unidad vs a granel

> **Objetivo:** los productos empacados se manejan en paquetes enteros; los productos a granel aceptan peso/volumen libre. Nada se redondea al operar.
> **Rama:** `fix/stock-unidades-discretas` (desde `main` dee44a3). **Migración:** 0059.
> **Runner:** Vitest (`npx vitest run`); SQL: `scripts/db-test.sh` (CI/schema-check).

## Specs

- **S1.** `products.is_bulk` (boolean, default `false`) distingue venta por unidad/paquete (`false`) de venta a granel por peso/volumen (`true`).
- **S2.** La base rechaza cantidades fraccionarias para productos con `is_bulk = false` en `stock.quantity`, `movements.quantity`, `order_items.quantity`, `order_items.received_quantity`, `distributor_products.quantity` y `distributor_purchases.quantity`. Un producto a granel conserva decimales (`numeric(12,3)`).
- **S3.** El stock existente de productos por unidad se normaliza una sola vez al paquete entero más cercano; el histórico (`movements`, `order_items`) no se reescribe. Los productos a granel no se tocan.
- **S4.** El formulario de producto expone la venta a granel; por defecto queda por unidad. El backfill marca a granel los productos de unidad `peso` y los de volumen cuyo nombre/descripción diga “granel” o “por litro”.
- **S5.** Las cantidades de la UI respetan el modo: los productos por unidad solo aceptan enteros (input `step=1`, sin separador decimal); los a granel aceptan decimales. Se muestra la unidad (`und`, `kg`, `L`).
- **S6.** El demo (`supabase/demo-catalog.sql`) ya no genera stock decimal para productos por unidad.
- **S7.** Tests SQL de los guards y del flag; tests Vitest de la UI de cantidades; suite completa.

## Tasks

| ID  | Specs | Ruta   | Estado | Evidencia                                                                                                                          |
| --- | ----- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| T1  | S1-S4 | inline | hecho  | Migración 0059: `is_bulk`, backfill único, guards, `get_order_items`                                                               |
| T2  | S2-S3 | inline | hecho  | Guards en 6 tablas; normalización de stock; demo sin decimales en unidades; test SQL 0059                                          |
| T3  | S4-S5 | inline | hecho  | `ProductForm`, `QuantityStepper`, `QuantityEditor`, `MovementCart`, `ProductList`, `StoreCatalogPanel` y páginas de pedido/entrega |
| T4  | S6-S7 | inline | hecho  | Docs 0059; tests Vitest de paso entero y alta a granel; suite completa pendiente de correr                                         |

## Log

- **L1 (2026-11-18):** «Lo del stock, no se debe redondear. Los productos empacados (agua 1L, harina 1kg) deben usar paquetes enteros; los productos sueltos usan peso libre (g/mg/kg) con precio por lb/kg.»
- **L2 (diseño):** el modelo actual guarda todo como `numeric(12,3)` y el seed de demo genera cantidades como 17,760 para “Arroz Diana 500 g”. No se puede inferir el modo solo de `unit_types.category` porque el agua de 1 L es `lt` y es un paquete. Se agrega `products.is_bulk`.
- **L3 (diseño):** los guards viven en triggers de tabla (no en CHECK con subconsulta) para cubrir todas las RPC actuales y futuras; el histórico no se reescribe.
- **L4 (diseño):** precio: para granel el precio cargado es por `kg`/`L` de la unidad del producto; para paquete es por paquete. La UI muestra el sufijo, sin conversiones automáticas.
- **L5 (diseño):** la UI NO filtra los decimales al teclear (evita convertir “2,5” en “25”); el submit valida entero y la base es la última barrera con un mensaje claro. Los triggers cubren también las RPC viejas y las futuras.
