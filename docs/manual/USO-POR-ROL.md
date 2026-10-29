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
| Poner precio a un producto en una tienda | Inventario → tienda → Precios | Admin o usuario **Premium**: el precio de venta es privado de la tienda. Opcional para pedir: el operador puede solicitar sin precio y el distribuidor cotiza |
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
| Ver el stock y su estado | Inventario → mi tienda → Productos | OK / Bajo / Agotado según el umbral |
| Agregar productos a mi tienda | Inventario → mi tienda → Productos → Agregar productos | Buscá en el registro; «Solo no añadidos» oculta los ya asignados. La columna «En la tienda» muestra el stock actual y bloquea los ya asignados. Si sos **Premium**, podés cargar el precio de venta en la misma fila. Cada fila agrega y el stepper − / + define la cantidad inicial |
| Editar cantidad y umbral | Inventario → mi tienda → Productos → Editar | Se abre un modal; los cambios se guardan una sola vez y sin registrar movimiento |
| Marcar o quitar un faltante | Inventario → mi tienda → Productos | Acción ámbar para marcar y esmeralda para resolver; se refleja en `/faltantes` |
| Quitar un producto de mi tienda | Inventario → mi tienda → Productos → Quitar | Botón rojo; con stock pide doble confirmación y descarta las existencias |
| Registrar una venta o una compra | Inventario → Registrar entrada o salida | Buscá el producto por nombre o marca, elegilo de la lista, ajustá la cantidad con − / + y poné el motivo (y vencimiento en entradas). **Requiere Premium**; si lo sos, podés indicar a cuánto se compró (entrada) o se vendió (salida) |
| Ver cuántas alertas tengo | Alertas | La pestaña muestra el número de alertas abiertas |
| Ver qué se está agotando | Alertas | Marcar leída cuando la revise |
| Pedir los faltantes al distribuidor | Faltantes → Solicitar faltantes | Elegí el distribuidor vinculado; el pedido abre con esos productos preseleccionados |
| Ver mis distribuidores vinculados | Distribuidores | Elegí la tienda; si no hay ninguno, aparece el código y el QR para vincular uno |
| Vincular un distribuidor | Distribuidores → Vincular otro distribuidor | Compartí el QR o dictá el código; el distribuidor lo escanea o lo escribe |
| Pedir mercancía | Pedidos → Nuevo pedido | Tienda → distribuidor **vinculado** → buscá por nombre o marca: un solo buscador y los productos se acumulan abajo. La cantidad se ajusta con − / +. El **stock mínimo** es un filtro opcional dentro de «Filtros». No hace falta precio: el pedido queda pendiente y el distribuidor lo cotiza. Los **faltantes de la tienda** se agregan con un clic |
| Seguir el pedido | Pedidos → pedido | El distribuidor lo marca en ruta y confirma la entrega; vos ves el estado, la fecha prometida y el precio cotizado por el distribuidor |
| Contactar a un distribuidor | Distribuidores → Contactar | Abre el WhatsApp/teléfono/email que el distribuidor configuró. Si no lo configuró, muestra «Sin contacto» |
| Configurar mi contacto | Perfil | Completá teléfono y preferencia (WhatsApp/Teléfono/Email). Para Email se usa el email de la cuenta |
| Cobrar un fiado | Fiado → crédito → Registrar pago | Monto y medio de pago |
| Crear el fiado de un pedido entregado | Pedidos → pedido entregado → Fiado → Registrar fiado | Fecha de vencimiento y monto; el distribuidor no puede crearlo |
| Imprimir o regenerar el QR de vínculo | Inventario → mi tienda → QR de vínculo | El creador de la tienda o un operador asignado a ella imprime el QR o dicta el código. Regenerarlo invalida el QR anterior |
| Ver entradas y salidas | Dashboard | **Requiere Premium** |

## Distribuidor (sus pedidos y su ruta)

| Quiero… | Dónde | Cómo |
|---|---|---|
| Vincularme a una tienda | Vincular tienda | Tocá “Escanear QR” y permití la cámara, o escribí el código manualmente. Si la cámara falla, el código sigue disponible |
| Ver mi ruta de hoy | Mi ruta | Mapa + lista de tiendas con solicitudes abiertas; las paradas asignadas quedan debajo |
| Elegir tiendas para el recorrido | Mi ruta | Marcá las tiendas de la lista; solo las marcadas aparecen en el mapa y se numeran igual en ambos lados |
| Guardar la ruta de hoy | Mi ruta → Guardar ruta | Guarda las tiendas marcadas como paradas de la ruta de hoy y actualiza el resumen (rutas hoy, paradas, completadas) |
| Abrir el recorrido en Google Maps | Mi ruta → Abrir en Google Maps | Usa las tiendas marcadas como origen, paradas y destino; no guarda una ruta nueva (para eso está Guardar ruta) |
| Gestionar mi catálogo | Productos | La misma vista de productos de la tienda: buscador, filtros, alta desde el registro, editar y quitar. Sin stock ni precio |
| Ver mis movimientos | Movimientos | Tus entregas/ventas aparecen como salidas con su precio; el stock de la tienda recibe la entrada. Filtros Entradas/Salidas |
| Registrar una venta directa | Movimientos → Registrar venta | **Requiere Premium**: tienda vinculada, producto de tu catálogo, cantidad y precio de venta |
| Contactar a una tienda | Mi ruta → Contactar | Abre el WhatsApp/teléfono/email que el operador configuró. Si no lo configuró, muestra «Sin contacto» |
| Configurar mi contacto | Perfil | Completá teléfono y preferencia (WhatsApp/Teléfono/Email). Para Email se usa el email de la cuenta |
| Marcar mis paradas | Mi ruta | Llegué → Completada (u Omitir) |
| Terminar la ruta | Mi ruta → Terminar ruta | Solo si el admin la inició |
| Ver mis pedidos | Mis pedidos | Solo los dirigidos a mi distribuidora; el nav muestra cuántos pedidos abiertos hay |
| Cotizar un pedido | Mis pedidos → pedido pendiente o en ruta → Cotización del distribuidor | Precio por producto; si sos Premium se sugiere el precio registrado. Se congela en el movimiento al confirmar la entrega. El operador de la tienda ve la cotización aunque no sea Premium |
| Marcar un pedido en ruta o devolverlo a pendiente | Mis pedidos → fila → En ruta / Pendiente | También desde el detalle del pedido |
| Entregar un pedido completo | Mis pedidos → fila → Entregar | Pide confirmación y suma todas las cantidades al stock. Para entregas parciales usá el detalle |
| Fijar la fecha prometida | Mis pedidos → pedido → Entrega y comunicación | Opcional; el operador la ve en el resumen. Podés cambiarla o quitarla mientras el pedido siga abierto |
| Confirmar una entrega | Mis pedidos → pedido → Confirmar entrega | Cantidades entregadas por producto (puede ser parcial); el stock sube solo |
| Ver mis movimientos | Movimientos | El mismo historial visual del operador, con la tienda de cada entrada/salida; filtros Entradas/Salidas |

## Guion corto de demo (H1 → H3)

1. **Admin:** crea el distribuidor (o el distribuidor se registra solo) y el producto.
2. **Operador:** crea su tienda en el mapa → Inventario → asigna el producto con umbral 10.
3. **Admin:** le da Premium al operador y le pone precio al producto en esa tienda.
4. **Operador:** entrada 20 → salida 12 → aparece la alerta "Stock bajo" → salida 9 → "No hay stock suficiente".
5. **Operador:** Distribuidores → código/QR de la tienda → **Distribuidor:** Vincular tienda → “Escanear QR” (o escribir el código).
6. **Operador:** Nuevo pedido de 24 (puede agregar los faltantes de la tienda con un clic). **Distribuidor:** marca el pedido en ruta. **Admin:** planifica la ruta de hoy e "Iniciar ruta".
7. **Distribuidor:** Mi ruta → Llegué → confirma la entrega de 20 de 24 → el stock sube 20.
8. **Operador Premium:** Dashboard → se ve la entrada del distribuidor.

## Limitaciones actuales

- Sin chatbot (CHAT-01/02).
- Sin actualización en tiempo real: las alertas y el dashboard se ven al recargar.
- Asignar tiendas a un trabajador todavía no tiene pantalla (hoy por SQL). Una vez asignada, ese operador ya puede generar el QR de vínculo (migración 0020) y ver sus distribuidores.
- El escaneo con cámara requiere HTTPS (o `localhost`) y permiso del navegador; sin cámara, el código se escribe a mano.
- Interfaz funcional, no final.
