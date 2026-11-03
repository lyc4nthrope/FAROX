# Movimientos: tickets multi-producto, compras del distribuidor y descuentos

Rama `daniel` · entrega por work-units · runner `npm run ci` (vitest + tsc + eslint + check-scope).

## Specs

- **S1.** En `/movimientos` (distribuidor), con el filtro **Todos** hay dos acciones: «Registrar venta» y «Registrar compra».
- **S2.** Con el filtro **Salidas** solo aparece «Registrar venta»; con **Entradas** solo «Registrar compra».
- **S3.** En `/inventario/:storeId`, pestaña **Movimientos**, rige el mismo patrón: filtro Todos/Entradas/Salidas y acciones «Registrar compra» (entrada) / «Registrar venta» (salida).
- **S4.** "En la vista de creacion de movimiento no estan centrados": el contenido del diálogo de creación queda en una columna centrada y no pegado a la izquierda de un diálogo ancho.
- **S5.** "deberia dejar escanear codigo de barras de productos para poder agregar un producto facil": botón de escaneo en el buscador; al leer un código se agrega el producto al ticket. Código desconocido ⇒ mensaje claro, sin agregar nada.
- **S6.** "una opcion de agregar varios productos sin tener que hacer uno a uno, sino ir agregando viendo una lista de que se agrega, cuanta cantidad y cuanto valor de venta o compra": ticket con varias líneas visibles (producto, cantidad, precio unitario, subtotal), editar cantidad, quitar línea y total del ticket.
- **S7.** "una opcion en la venta (para distribuidor y operador) para generar descuentos de ser necesario": descuento porcentual 0–100 en ventas; se recalcula el neto y se persiste `discount_pct` en cada movimiento.
- **S8.** Compra del distribuidor: registro atómico de compras con costo unitario y vencimiento; suma stock a `distributor_products` y aparece como **Entrada** en su lista de movimientos.
- **S9.** Atomicidad: un ticket se aplica completo o no se aplica (una sola RPC por ticket).
- **S10.** La lista de movimientos muestra el descuento aplicado cuando existe.
- **S11.** Sin cambios de comportamiento para quien no use las nuevas acciones: los movimientos de un solo producto siguen registrándose igual desde el mismo diálogo.

## Tasks

- **T1.** Migración `0037`: `movements.discount_pct`, tabla `distributor_purchases`, RPCs `register_movements_bulk`, `register_distributor_sales_bulk`, `register_distributor_purchases`, RLS y grants. — inline — hecho (sin aplicar en Supabase)
- **T2.** API del frontend: tipos de línea, llamadas bulk, compras del distribuidor, `barcode` en opciones de stock. — inline — hecho
- **T3.** `MovementCart`: buscador + escáner + líneas + descuento + totales. — inline — hecho
- **T4.** `InventoryPage`: filtros, botones contextuales, ticket y descuento. — inline — hecho
- **T5.** `DistributorMovementsPage`: botones contextuales, venta y compra con ticket, feed unificado. — inline — hecho
- **T6.** `Modal`: tamaño configurable y contenido centrado. — inline — hecho
- **T7.** Tests y CI. — inline — hecho (761/761)

## Log

### L1 — pedido del usuario (verbatim)

> En la vista de movimientos, cuando este la opcion de todos aparezca 2 botones para generar movimiento de salida y otro boton de entrada, y cuando se cambio de pestaña para salida si aparezca solo el botono de venta y si es la seccion de entrada el boton diga compra.
> En la vista de creacion de movimiento no estan centrados. Ademas, deberia dejar escanear codigo de barras de productos para poder agregar un producto facil, y que haya una opcion de agregar varios productos sin tener que hacer uno a uno, sino ir agregando viendo una lista de que se agrega, cuanta cantidad y cuanto valor de venta o compra, y una opcion en la venta (para distribuidor y operador) para generar descuentos de ser necesario.
> Y me gustaria ideas para mejorar la apariencia y la usabilidad de las acciones, para que el usuario ve que es facil y rapido, que si vea beneficio en hacer esto en vez de anotar en paapel o ha memoria.

### L2 — decisión de modelo (2026-11-03)

El usuario eligió **con migración**: se agrega ledger de compras del distribuidor y descuento persistido.

### L3 — hallazgos

- `movements.store_id` es NOT NULL y no existe RPC de compra para distribuidor: la compra va a tabla propia `distributor_purchases`.
- `movements` no tenía campo de descuento: se agrega `discount_pct` y se audita junto al `unit_price` neto.
- `register_entry` (7 args) y `register_exit` (6 args) son overloads de 0027; las tickets los reusan con notación nombrada para no duplicar guards.
- `register_distributor_sale` no descuenta stock del distribuidor (comportamiento previo); la compra sí suma a `distributor_products.quantity`.

### L4 — implementación (2026-11-03)

- Migración `supabase/migrations/20261103000037_ventas_multiples_compras_y_descuentos.sql`: pendiente de aplicar en Supabase (no hay DB local en este entorno).
- `MovementCart` reemplaza el alta de un solo producto en ambos roles; el descuento se aplica al total y el neto por línea se envía como `unit_price`.
- La lista del distribuidor mezcla `movements` (ventas/entregas) y `distributor_purchases` (compras), ordenadas por fecha descendente.
- `npm run ci` en verde: 97 archivos, 761 tests.

### L5 — límite conocido

- Las ventas directas del distribuidor todavía NO descuentan `distributor_products.quantity`; la compra sí lo suma. Queda como deuda explícita para no bloquear ventas con stock en 0.

### L6 — venta rápida y últimos vendidos (2026-11-03)

- **S12.** Escanear en el ticket mantiene la cámara activa: cada lectura agrega el producto y el mismo código dentro de 1,5 s se ignora (evita sumar decenas por tener el producto enfrente).
- **S13.** En el buscador, `Enter` agrega sin tocar la lista: primero busca coincidencia exacta de código de barras; si el filtro deja un solo candidato, agrega ese; limpia el buscador y deja el foco listo para el siguiente.
- **S14.** «Últimos vendidos»: hasta 6 productos vendidos recientemente (sin reversos) como atajos arriba del ticket; un toque los agrega o suma una unidad.
- `MovementRow` ahora expone `product_id` para derivar los atajos de los movimientos ya cargados (sin request extra).
- `npm run ci` en verde: 762 tests.
