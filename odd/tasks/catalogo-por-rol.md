# Catálogo de productos por entidad (tienda / distribuidora / admin)

Branch: `feat/catalogo-por-rol` · Delivery: `ask-on-risk` · Test runner: `npm test` (Vitest)

## Specs

- **S1** — El admin conserva la vista general: `/products` lista todos los productos registrados y mantiene el alta/edición del catálogo global.
- **S2** — La tienda ve en `/products` solo los productos asignados a la(s) tienda(s) DE ESE USUARIO (`my_store_ids()`). Su catálogo es la asignación `stock` (producto ↔ tienda), no una copia nueva. La relación es por entidad, NO por el nombre del rol.
- **S3** — El distribuidor ve en `/products` solo los productos de la distribuidora DE ESE USUARIO (`my_distributor_id()`), guardados en `distributor_products`. La relación es por entidad, NO por el nombre del rol.
- **S4** — Tanto tienda como distribuidor ven, en la misma vista, la lista de TODOS los productos activos registrados y pueden agregar los que manejan/venden. Tienda: `assign_product_to_store`; distribuidor: `add_distributor_product`.
- **S5** — Quitar del catálogo: distribuidor vía `remove_distributor_product`; tienda vía `unassign_product_from_store`, que solo borra la asignación si `stock.quantity = 0` (nunca se pierde inventario).
- **S6** — Las mutaciones refrescan la lista al volver (sin realtime), como el resto del front.
- **S7** — El alta de producto global (`/products/new`) queda solo para admin; operador y distribuidor ya no crean ni editan productos globales (solo leen el registro para elegir).

## Tasks

| ID | Specs | Route | Status | Evidence |
|----|-------|-------|--------|----------|
| T1 | S2,S3,S5 | inline | done | `supabase/migrations/20261025000019_catalogo_por_rol.sql` (tabla + 3 RPCs + RLS/grants) |
| T2 | S4,S5 | inline | done | `api.ts` (fetch/add/remove catálogo) + `MyCatalogPage.tsx` |
| T3 | S1,S2,S3,S4,S6 | inline | done | `ProductsPage.tsx` dispatcher, `AdminProductsPage.tsx`, `MyCatalogPage.tsx`; 25 tests de products en verde |
| T4 | S7 | inline | done | `router.tsx` `/products/new` = ADMIN_ONLY; `ProductFormPage` `canWrite` admin-only |
| T5 | S1-S7 | inline | done | `npm test` 460/460 · `npm run lint` · `npm run typecheck` · `npm run check-scope` |

## Log

### L1 — Pedido del usuario (verbatim)

Mira, en la vista de productos es igual para todos, pero no deberia ser asi, cada uno debe tener sus propios productos relacionando los existentes que si se permiten ver a todos. La idea es que de la tienda escoja que productos tienen en su tienda de todos los productos registrados en la base de datos, igualmente para el distribuidor, el unico que tiene una vista general es el admin.
Por lo tanto la vista seria, agregar productos a mi catalogo (tienda y distribuidor), le aparece la lista de todos los productos que hay y selecciona los productos que maneja/vende, y cuando mire la vista de productos pueda ver esos productos que agrego.
Puedes hacer eso?

### L2 — Decisiones de diseño

- Catálogo de tienda = `stock` (ya existe `assign_product_to_store` y la RLS por tienda). No se duplica la fuente de verdad.
- Catálogo de distribuidor = tabla nueva `distributor_products` + RPCs, porque no existía relación producto ↔ distribuidor.
- Quitar de tienda exige `quantity = 0`: borrar una fila de stock con existencias perdería inventario.
- La RLS de `products` sigue siendo `USING true` (todos leen el registro global para poder elegir); el filtro por rol es de vista y la escritura sigue en RPC/RLS.
- Migración: `supabase/migrations/20261025000019_catalogo_por_rol.sql`. El MCP de Supabase está en `read_only` y con `apply_migration` denegado: la aplica el usuario en el SQL editor.

### L3 — Aclaración del usuario (2026-10-25, paráfrasis: el texto exacto se perdió en la compactación)

Corrección de alcance: la relación NO se decide por el nombre del rol, sino por la ENTIDAD del usuario. La tienda es la de ese usuario (`my_store_ids()`) y la distribuidora es la de ese usuario (`my_distributor_id()`). Por eso `/products` solo separa "admin = vista general" de "el resto = catálogo de sus propias entidades"; no hay ramas por `operador`/`distribuidor` para decidir qué catálogo mostrar.

### L4 — Verificación (2026-10-25)

- `npm test -- --run` → 52 archivos, 451 tests en verde.
- `npm run lint` → sin errores.
- `npm run typecheck` → limpio (antes fallaba por `qrcode` ausente en `node_modules`; resuelto con `npm install`, sin cambios en `package-lock.json`).
- `npm run check-scope` → §S8 OK, 0 coincidencias en 204 archivos.
- Pendiente del usuario: aplicar 0019 en el SQL editor de Supabase; hasta entonces `distributor_products` no existe y el catálogo del distribuidor muestra el error mapeado.

### L5 — Verificación independiente y corrección (2026-10-25)

El verificador independiente devolvió **BLOCKED** con 2 bloqueadores:

1. **S5 — dead end**: un producto INACTIVO ya asignado aparecía en el catálogo pero no en el registro de "agregar" (que filtra `is_active`), así que no había forma de quitarlo. Corregido: la acción "Quitar" vive ahora en la tabla del catálogo (columna Acción de `ProductList`), con "Con stock (X)" cuando `quantity > 0`.
2. **S4 — truncación silenciosa**: `fetchStoreCatalog`, `fetchDistributorCatalog` y `fetchActiveProductsForCatalog` tenían `.limit(500)` sin paginación. Corregido: los tres usan `useList` + `.range()` con `count: 'planned'` y `Pager` (25 por página, `PAGE_SIZE`).

Advisories aceptadas sin cambio de alcance: (A1) la DB todavía permite insert/update de `products` a operador (S7 es de UI; la policy es preexistente y cambiarla excede este pedido), (A2) el FAIL esperado de 0012 por +3 firmas, (A3) los textos de RAISE nuevos caen en el mensaje genérico de `mapError`.

Verificación tras la corrección: `npm test -- --run` → 53 archivos, 460/460 · `lint` · `typecheck` · `check-scope` (§S8 OK). Recheck independiente acotado a B1/B2: **PASS WITH ADVISORIES** — ambos FIXED; los tests nuevos fallan contra la implementación anterior (RED observado), así que no son tautologías. Advisories menores aceptadas: "Agregar" sigue visible para un producto ya presente (upsert idempotente), el buscador filtra la página cargada (el label lo dice), y un alta resetea el catálogo a la página 1.


