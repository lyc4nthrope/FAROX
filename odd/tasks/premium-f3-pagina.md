# FAROX — Premium F3: página de planes, comparativa y CTAs

> **Objetivo:** que el usuario entienda el valor de Premium, vea el precio desglosado y llegue a la página de planes desde la landing y el perfil.
> **Rama:** `daniel`. **Entrega:** commits de unidad; sin push.
> **Runner:** `npm run test`, `typecheck`, `lint`, `check-scope`, `build`.
> **Plan de referencia:** `odd/tasks/premium-suscripciones-mercado-pago.md` (F3).

## Specs

- **S1.** `/premium` muestra la comparativa Free vs Premium con funciones reales: 1 vs 3 tiendas, dashboard, movimientos manuales, precios/venta directa, inventario/pedidos/rutas/fiado/alertas. No prometer «QR masivo» hasta implementarlo.
- **S2.** `/premium` muestra los dos planes con el desglose real de `quote_plan` (precio final, IVA incluido, comisión MP estimada, neto FAROX) y la nota de que la comisión se descuenta del recaudo.
- **S3.** La landing pública tiene una sección Premium con el precio de entrada y CTA a registro; el perfil tiene «Ver planes» y «Gestionar mis tiendas».
- **S4.** Si el usuario ya es Premium, `/premium` muestra su estado/fecha y no le ofrece pagar de nuevo; si es free, el CTA de pago queda deshabilitado hasta F4 con un mensaje claro.
- **S5.** FAQ con renovación, cancelación, qué pasa al vencer, medios de pago (PSE a confirmar), impuestos y contacto; link a Privacidad.
- **S6.** Sin promesas legales no verificadas; los textos respetan la cancelación en cualquier momento y la no pérdida de datos.
- **S7.** Backlog anotado: edición/eliminación/transferencia de tiendas (nombre, dueño, menos tiendas) para una fase posterior; no se implementa en F3.

## Tasks

| ID  | Specs        | Ruta   | Estado | Evidencia                                                                     |
| --- | ------------ | ------ | ------ | ----------------------------------------------------------------------------- |
| T1  | S1-S2, S4-S6 | inline | hecho  | `/premium`: comparativa, FAQ, estado actual, planes/desglose                  |
| T2  | S3           | inline | hecho  | sección Premium en landing + «Ver planes» y «Gestionar mis tiendas» en perfil |
| T3  | S7           | inline | hecho  | backlog de edición/eliminación/transferencia en el plan                       |
| T4  | S1-S6        | inline | hecho  | tests UI/copys, typecheck, lint, check-scope, build                           |

## Log

- **L1 (2026-11-02):** «Si, ademas puedes anotar que se deberia poder editar o eliminar una tienda (dado el caso que una tienda ya no sea de su propiedad o por cuestiones cambien de nombre o solo tenga menos tiendas).» Se continúa con F3 y se anota el backlog de tiendas.
- **L2 (2026-11-02):** F3 implementado: `/premium` con comparativa, FAQ, estado actual y desglose; sección Premium en landing; «Ver planes» y «Gestionar mis tiendas» en perfil; backlog de tiendas en el plan. 42 tests focales y build en verde.
