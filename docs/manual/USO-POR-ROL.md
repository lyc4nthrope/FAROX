# FARØX — Cómo se usa la app por rol

Guía rápida para la demo y base del manual de usuario (tarea C7). Estado al 2026-10-25.

## Antes de empezar

- **Registro:** `/register` → aceptar la política de privacidad → confirmar el email.
- **Olvidé mi contraseña:** en `/login` → “¿Olvidaste tu contraseña?” → escribí tu email → abrí el link → elegí una nueva (mínimo 6 caracteres).
- **Primera vez (pregunta "¿Qué sos?"):**
  - **Distribuidor**: registra su empresa (nombre + NIT) y queda con rol distribuidor.
  - **Mi tienda**: crea su tienda eligiendo la ubicación en el mapa y queda como operador de esa tienda.
  - **Trabajo en tienda**: espera a que el admin le asigne tiendas.
- El **admin** no pasa por esa pregunta. El primer admin se crea a mano en la base de datos (ver `supabase/README.md`).
- **Premium** lo activa el admin en Usuarios. Habilita: registrar entradas/salidas manuales, el dashboard y ver precios en los pedidos.

## Admin (configura y supervisa todo)

| Quiero… | Dónde | Cómo |
|---|---|---|
| Dar rol, Premium o desactivar a alguien | Usuarios → usuario | Cambiar y confirmar. No se puede quitar al último admin |
| Asignar tiendas a un trabajador | Usuarios → usuario → tiendas | (pendiente en la UI; hoy por SQL) |
| Crear catálogos | Catálogos | Marcas, categorías, unidades, tipos de tienda, motivos |
| Crear distribuidores | Distribuidores → Nuevo | Nombre + NIT único |
| Poner precio a un producto en una tienda | Inventario → tienda → Precios | Obligatorio antes de que esa tienda pueda pedir ese producto |
| Revertir un movimiento equivocado | Inventario → tienda → Últimos movimientos → Revertir | Pide motivo; el original queda en el historial |
| Planificar la ruta del día | Rutas → Planificar ruta | Distribuidor, fecha, tiendas en orden (↑ ↓), hora estimada |
| Iniciar o cancelar una ruta | Rutas → ruta | "Iniciar ruta" (el distribuidor solo puede terminar rutas iniciadas) |
| Cancelar un pedido | Pedidos → pedido → Cancelar | Pide motivo |
| Fiar un pedido entregado | Pedidos → pedido entregado → Fiado | Fecha de vencimiento opcional; luego se cobra en Fiado |
| Ver quién cambió qué | Auditoría | Filtrar por tabla |
| Reactivar algo desactivado | Producto / tienda / distribuidor → Reactivar | Solo admin |

## Operador (día a día de sus tiendas)

| Quiero… | Dónde | Cómo |
|---|---|---|
| Ver el stock y su estado | Inventario → mi tienda | OK / Bajo / Agotado según el umbral |
| Agregar un producto a mi tienda | Inventario → Asignar producto | Umbral opcional para recibir alertas |
| Registrar una venta o una compra | Inventario → Registrar entrada o salida | Tipo, producto, cantidad, motivo (y vencimiento en entradas). **Requiere Premium** |
| Ver qué se está agotando | Alertas | Marcar leída cuando la revise |
| Pedir mercancía | Pedidos → Nuevo pedido | Tienda → distribuidor → productos y cantidades. Cada producto necesita precio (lo pone el admin) |
| Mandar el pedido a ruta | Pedidos → pedido → Marcar en ruta | |
| Recibir un pedido | Pedidos → pedido → Confirmar entrega | Cantidad recibida por producto (puede ser parcial); el stock sube solo |
| Cobrar un fiado | Fiado → crédito → Registrar pago | Monto y medio de pago |
| Que un distribuidor se vincule | Inventario → mi tienda → QR de vínculo | El creador de la tienda o un operador asignado a ella imprime el QR o dicta el código |
| Ver entradas y salidas | Dashboard | **Requiere Premium** |

## Distribuidor (sus pedidos y su ruta)

| Quiero… | Dónde | Cómo |
|---|---|---|
| Vincularme a una tienda | Vincular tienda | Escanear el QR con la cámara del celular o escribir el código |
| Ver mi ruta de hoy | Mi ruta | Paradas en orden y "Abrir recorrido en Google Maps" |
| Marcar mis paradas | Mi ruta | Llegué → Completada (u Omitir) |
| Terminar la ruta | Mi ruta → Terminar ruta | Solo si el admin la inició |
| Ver mis pedidos | Mis pedidos | Solo los dirigidos a mi distribuidora |
| Confirmar una entrega | Mis pedidos → pedido → Confirmar entrega | Cantidades recibidas por producto |

## Guion corto de demo (H1 → H3)

1. **Admin:** crea el distribuidor (o el distribuidor se registra solo) y el producto.
2. **Operador:** crea su tienda en el mapa → Inventario → asigna el producto con umbral 10.
3. **Admin:** le da Premium al operador y le pone precio al producto en esa tienda.
4. **Operador:** entrada 20 → salida 12 → aparece la alerta "Stock bajo" → salida 9 → "No hay stock suficiente".
5. **Operador:** QR de vínculo → **Distribuidor:** Vincular tienda con el código.
6. **Operador:** Nuevo pedido de 24 → Marcar en ruta. **Admin:** planifica la ruta de hoy e "Iniciar ruta".
7. **Distribuidor:** Mi ruta → Llegué → confirma la entrega de 20 de 24 → el stock sube 20.
8. **Operador Premium:** Dashboard → se ve la entrada del distribuidor.

## Limitaciones actuales

- Sin chatbot (CHAT-01/02).
- Sin actualización en tiempo real: las alertas y el dashboard se ven al recargar.
- Asignar tiendas a un trabajador todavía no tiene pantalla (hoy por SQL). Una vez asignada, ese operador ya puede generar el QR de vínculo (migración 0020).
- Interfaz funcional, no final.
