# UX P1 — consolidar vistas y reducir densidad

Rama: `daniel` · Entrega: commits por unidad · Runner: `node node_modules/vitest/vitest.mjs run`

Objetivo: ejecutar la segunda prioridad de la auditoría UX sin cambiar reglas de datos ni seguridad (SEC-01/RLS intactos).

## Specs

- **S1** — «mira si hay vistas que se pueden juntar para no haya tantas opciones que puedan asustar al usuario por tantas cosas en pantalla».
  Faltantes deja de ser una entrada de navegación y pasa a ser una pestaña de Pedidos para admin y operador. La ruta `/faltantes` sigue existiendo para enlaces directos.
- **S2** — «revisa que los botones y pestañas tengan un nombre claro, corto, preciso y que tengan un orden (por frecuencia de uso)».
  El detalle de pedido expone su acción primaria en una barra visible antes del detalle, sin obligar a bajar hasta el final.
- **S3** — El Dashboard del distribuidor no muestra un desglose multi-distribuidor que no aplica a su alcance; muestra su propia operación (entradas, salidas, movimientos, días con movimiento).
- **S4** — En Mi ruta, las acciones de las paradas asignadas («Llegué», «Completar», «Omitir», «Terminar ruta») quedan antes de la planificación, para no quedar debajo del mapa.
- **S5** — Unificar la experiencia de tienda entre `/stores` y `/inventario`. **Pendiente de decisión de producto**: hub `Tiendas` con pestañas por tienda vs. `/inventario` como única lista.

## Tareas

- **T1** — Faltantes como pestaña de Pedidos; quitar `/faltantes` del nav. Ruta: inline. Estado: hecho.
- **T2** — Barra de acción primaria en el detalle de pedido. Ruta: inline. Estado: hecho.
- **T3** — Dashboard del distribuidor acotado a su operación. Ruta: inline. Estado: hecho.
- **T4** — Reordenar Mi ruta: ruta de hoy antes de la planificación. Ruta: inline. Estado: hecho.
- **T5** — Tiendas/Inventario. Ruta: pendiente de decisión. Estado: bloqueada.

## Log

- **L1** — «Haz commit y sigue con P1»
- **L2** — Decisión asumida para T3: se conserva el Dashboard (no se oculta una función Premium) y se elimina el desglose por distribuidor para el rol distribuidor.
- **L3** — Decisión asumida para T5: no se toca hasta confirmar el modelo de navegación, porque cambia la ruta de entrada diaria del operador.
