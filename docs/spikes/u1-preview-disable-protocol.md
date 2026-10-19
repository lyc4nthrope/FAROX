# Spike U1 — Protocolo de verificación: previews de Azure SWA deshabilitados

**Estado**: **AWAITING-HUMAN-EXECUTION** — protocolo listo; ningún resultado está fabricado.
**Tarea**: #510 T3.2 · **Spec**: DEV-02 ("previews sin datos") · **Design**: #507 §1 (U1) · **Pins**: #506 (3).
**Timing**: ~15 min (incluye una ventana de espera de ~5 min para que cualquier preview inesperada llegue a aprovisionarse).

**Grounding `idea basica proy admin de proys.md:198` + posture de seguridad (:194-195)** ("HTTPS obligatorio" · `service_role` prohibido · las tools heredan RLS): una preview de Azure SWA es una URL **pública incluso en repos privados** (docs learn.microsoft.com, PR review/publish). Apuntaría al único proyecto Supabase —producción—, exponiendo la app con datos reales tras una URL pública. Por eso el binding decision "previews sin datos" (DEV-02) es seguridad, no estética. No hay conflicto con el documento de idea; lo respalda.

---

## Por qué es un protocolo humano (y no un workflow)

Los previews son un fenómeno **portal + workflow** de Azure: existen **iff** algún workflow del repo observa eventos PR — docs: *"When a pull request is created against a branch that the workflow watches, the pre-production environment gets built"* + *"Only GitHub Actions deployments support pre-production environments"* (learn.microsoft.com review-publish-pull-requests). Verificar su ausencia requiere tres superficies que solo un humano ve: el portal Azure (Environments tab), la lista de runs de Actions y el hilo del PR.

## Pre-requisitos (hard deps)

- [ ] **T0.1**: `package-lock.json` commiteado (sino, `deploy-front` rojo por `npm ci` — ruido que contamina la observación).
- [ ] **T1.1 (G1)**: app SWA creada + repo conectado + deployment token como repo secret. El workflow **generado por el portal** revisado: triggers `pull_request` **eliminados** (design U1: *"strip PR triggers from EVERY workflow Azure generates at G1"* — la plantilla del portal los trae por defecto) y nombres de inputs conservados VERBATIM (U5).
- [ ] **T2.4**: `deploy-front.yml` merged — `on: push: branches: [main]` SIN `pull_request` (grep = 0).

## Protocolo (4 puntos de éxito, design #507 §1 U1)

1. Crear rama `spike/u1-test-pr` desde `main` con un cambio trivial (un comentario/espacio en un archivo inocuo) y **abrir un PR contra `main`**.
2. **Esperar ~5 min** — los previews tardan en aprovisionarse; el "cero" se observa tras una ventana, no al instante.
3. **Actions**: verificar **CERO runs** de workflows de deploy para el evento PR del test (`deploy-front.yml` es push[main]-only por construcción; la verificación confirma además que ningún workflow generado por Azure dispara).
4. **Portal Azure → Static Web Apps → \<app\> → tab Environments**: SOLO `"production"` (**screenshot**).
5. **Hilo del PR**: NINGÚN comentario del bot de Azure SWA con preview URL (el bot-comment = señal de entrega de preview, docs learn.microsoft.com).
6. **Cerrar el PR** (y borrar la rama).

## Rúbrica de decisión

| Resultado observado | Significado | Acción |
|---|---|---|
| Los 4 puntos limpios (runs de deploy = 0 · Environments = solo "production" · sin bot comment · PR cerrado) | **U1 RESUELTO** — previews deshabilitadas por construcción (workflow-driven, #506 pin 3) | Registrar evidencia (screenshot + link del PR) vía `mem_save` en engram, o como comentario en el PR (ACCEPT de T3.1/T3.2); sale U3/U1 del registro UNVERIFIED |
| CUALQUIER preview (bot comment · env extra en el portal · run de deploy en el PR) | DEV-02: **accepted-risk entry** + **HUMAN-SIGNED-OFF** + borrar el env stray vía portal → Environments tab; investigar qué workflow observa eventos PR (¿el generado en G1?) y quitarle `pull_request` | Repetir el protocolo tras el fix |
| >0 previews aunque sea 1 | señal de **CONFIG DRIFT**, no licencia — Free = 3 pre-prod envs es un *backstop* (learn.microsoft.com plans), no permiso | Investigar triggers, borrar el env |

**NO CLAIM**: no existe en docs un toggle global del lado del portal para deshabilitar previews (#506 pin 3 — *"No portal-side global disable toggle found in docs"*). El mecanismo bajo nuestro control son **los triggers del workflow**. No afirmar lo contrario.

## Qué desbloquea

- **PASS** ⇒ U1 cerrado: satisface el verify HUMAN de DEV-02 (*"Azure portal 'Preview environments' list empty after opening a test PR"*) complementando el verify MACHINE de T2.4 (grep de triggers).
- **FAIL** ⇒ accepted-risk firmado + mitigación viva (borrado manual de envs + revisión de triggers generated en cada cambio de G3/merges).
