# Vínculo distribuidor y solicitud de productos

Rama: `feat/catalogo-por-rol` · Entrega: commits por unidad en la rama (push al cerrar) · Runner: `npm.cmd` + `npx.cmd vitest`

## Specs

- **S1** — En `/distributors`, un usuario con rol `operador` ve **solo los distribuidores vinculados a la tienda seleccionada**. Si no hay ninguno, ve la opción **“Vincular distribuidor”** con el código y el QR de la tienda para que el distribuidor los escriba o escanee.
- **S2** — Si el operador ya tiene distribuidores vinculados, ve la lista con nombre, fecha de vínculo y acciones **“Solicitar productos”** y **“Desvincular”**; además puede mostrar el código/QR para vincular otro. El administrador conserva la lista global y el CRUD actual.
- **S3** — En `/vincular`, el distribuidor tiene un botón **“Escanear QR”** que pide permiso de cámara, escanea el QR de la tienda y vincula automáticamente; si rechaza la cámara o falla el escaneo, ve un mensaje amigable y puede **escribir el código** manualmente. Nunca se muestra el error crudo del navegador.
- **S4** — El vínculo sigue siendo inmediato (sin aprobación posterior del dueño), se crea por la RPC existente y el dueño puede regenerar el código o desvincular. Un código regenerado invalida el QR anterior.
- **S5** — En `/pedidos/nuevo`, un operador solo puede elegir distribuidores **vinculados** a la tienda seleccionada y solo puede pedir productos que estén **a la vez** en el catálogo del distribuidor (`distributor_products`) y en el catálogo de la tienda (`stock`). Los productos sin precio activo se muestran deshabilitados. El backend repite ambas validaciones; la UI no es la única defensa.
- **S6** — El administrador conserva el flujo actual (cualquier distribuidor activo y cualquier producto con precio activo). Los errores nuevos se traducen con `mapError`; se agregan pruebas de contrato SQL, API y UI; se actualiza la documentación de producción y uso por rol.

## Tasks

- [x] T1 (S5) — Migración 0021: RPC `list_store_distributor_products` + `create_order` con guardas de vínculo e intersección; test de contenido SQL. Ruta inline. Evidencia: `src/test/store-distributor-requests.test.ts`; migración `20261025000021_store_distributor_requests.sql`.
- [x] T2 (S1, S2, S5) — API de vínculos: opciones de distribuidores vinculados, productos solicitables y tiendas del operador; tests de contrato. Ruta inline. Evidencia: `src/features/store-links/api.ts`, `api.test.ts`.
- [x] T3 (S1, S2, S4) — Vista del operador en `/distributors` con selector de tienda, lista de vinculados, CTA de código/QR y acciones; tests de UI. Ruta inline. Evidencia: `MyDistributorsPage.tsx`, `StoreLinkPanel`, `DistributorsPage.test.tsx`.
- [x] T4 (S3) — Escáner QR con cámara en `/vincular` (dependencia `@zxing/browser`), extracción segura del código y fallback manual; tests. Ruta inline. Evidencia: `QrScanner.tsx`, `scan.ts`, `StoreLinkPages.test.tsx`.
- [x] T5 (S5, S6) — `/pedidos/nuevo` con distribuidores vinculados e intersección de productos, `mapError`, docs y gate completo. Ruta inline. Evidencia: `NewOrderPage.tsx`, `NewOrderPage.test.tsx`, `mapError.ts`, docs actualizadas.

## Log

### L1 — Pedido original (2026-10-25)

> Haz commit y push.
> Luego, quiero que en la vista de distribuidores en el usuario operador de la tienda (dueño) aparezca los distribuidores con los que tiene un vinculo, sino que aparezca la opcion vincular un distribuidor (donde sera la generacion del codigo y qr para que escriba o escanee el distribuidor). Asi mismo, que el distribuidor le aparezca un boton para escanear (en su vista) para que pida permiso a la camara y escanear el codigo (si no quiere pues escribe el codigo).
> Cuando el operador tenga un distribuidor vinculado, el puede solicitar productos al dsitruibidor de los cuales el y el proveedor tengan.

### L2 — Diagnóstico y decisiones (2026-10-25)

- Commit y push hechos antes de empezar la feature: `c7f82e9` en `origin/feat/catalogo-por-rol`.
- Ya existe el vínculo tienda ↔ distribuidor por QR (0017/0020): el dueño/operador genera `stores.link_code`, el distribuidor entra a `/vincular/:code` o escribe el código y la RPC `link_distributor_to_store` inserta en `store_distributors`.
- Faltaba la vista del operador: `/distributors` mostraba el catálogo global (solo lectura para operador), no sus vínculos.
- Faltaba escaneo dentro de la app: el QR se abría con la cámara nativa del celular; no había permiso de cámara ni lector embebido.
- “Solicitar productos” se resuelve con el pedido existente (`orders` + `create_order`). Decisión del usuario: **intersección de catálogos** (stock de la tienda ∩ `distributor_products` del distribuidor) y precio activo de la tienda, sin crear una entidad de solicitud nueva.
- El precio sigue siendo el de `price_publications` de la tienda; si no hay precio activo, el producto se muestra deshabilitado y el backend mantiene el error actual. No se inventa precio de distribuidor.
- El administrador no se restringe: conserva el flujo global. Las guardas de vínculo/intersección aplican al rol operador.

### L3 — Implementación y verificación (2026-10-25)

- Dependencias exactas agregadas: `@zxing/browser@0.2.1` y `@zxing/library@0.23.0` (0 vulnerabilidades).
- UI: operador en `/distributors` ve selector de tienda, lista de vinculados, “Solicitar productos” y “Desvincular”; sin vínculos ve el código/QR con “Regenerar código” e “Imprimir”. El admin conserva la lista global.
- Distribuidor: `/vincular` tiene “Escanear QR” (permiso de cámara bajo demanda), fallback manual y errores amigables; el QR solo se acepta si el código es hex de 18 caracteres y, si es URL, del mismo origen.
- Pedidos: operador elige solo distribuidores vinculados y la RPC devuelve la intersección `distributor_products ∩ stock` con precio activo; productos sin precio deshabilitados. El admin no cambia.
- Gate: typecheck 0, lint 0, check-scope 0 en 228 archivos, **65 archivos / 529 tests** verdes, build OK. Sin Supabase/Postgres local: el SQL se valida por contenido y las pruebas de cámara/DB real quedan UNVERIFIED.

