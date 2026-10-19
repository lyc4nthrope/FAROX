# Spike U3 — Harness de `migration repair` para el baseline (CI-only, cero credenciales)

**Estado**: **AWAITING-HUMAN-EXECUTION** — el harness está listo; ningún resultado está fabricado.
**Tarea**: #510 T3.1 · **Spec**: DEV-04 (+ INV-6, risks (a)/(d)) · **Design**: #507 §2.4 (probes P1-P6).
**Discrepancia registrada**: #510 T2.5 preveía el job `baseline-spike` dentro de `schema-deploy.yml`; B2 difer T2.5 (gated on spike U3), así que el harness vive en un workflow dedicado: `.github/workflows/spike-repair.yml` (`workflow_dispatch`). Mismo alcance P1-P6.

**Grounding `idea basica proy admin de proys.md:198`** ("Higiene básica": *backups PITR de Supabase, `audit_log` activo desde Sprint 1*): un baseline mal manejado — un `push` ciego que re-aplica las 12 migraciones sobre un esquema ya aplicado a mano — corrompería el hardening de RLS de `0012` y los triggers de `audit_log`. El spike es la prevención documentada de ese escenario (spec risks (a)+(d)). No hay conflicto con el documento de idea; lo respalda.

---

## Cómo ejecutarlo (humano, ~10 min)

1. Merge a `main` de `.github/workflows/spike-repair.yml` (o correrlo desde la rama feature — `workflow_dispatch` está disponible en cualquier rama).
2. **Actions → "Spike U3 Repair Baseline" → Run workflow.**
3. Leer el bloque **VEREDICTO** en el *summary* del run (pestaña resumen, no solo el log crudo).
4. Descargar el artefacto `spike-u3-repair-baseline` (logs P1-P5, DDLs, `config.toml`, `verdict.txt`; retención 30 días).
5. **Registrar el resultado en engram** (`mem_save`, proyecto `farox`): rama A o B, PASS/FAIL/INCOMPLETO. Es el ACCEPT de T3.1: *"branch A/B decision recorded in engram before T4.2/T5.1"*.

## Qué hace (probes, design #507 §2.4)

| Probe | Qué observa | Artefacto |
|---|---|---|
| P1 | Stack fresco (`supabase start -x`, solo postgres): ¿existe `supabase_migrations.schema_migrations`? DDL + filas capturadas | `p1-fresh.log`, `p1-schema-migrations.sql`, `p1-table-def.txt` |
| Normaliza | `DROP SCHEMA IF EXISTS supabase_migrations CASCADE` en el **stack local desechable** — fuerza el estado "tabla inexistente" | log del paso |
| P2 | `repair 20261015000001 --status applied --local` contra tabla INEXISTENTE: ¿la crea (**rama A**) o falla (**rama B**)? stdout + exit capturados verbatim | `p2-repair.log` |
| Rama B | Si B: recrea la tabla desde el DDL capturado en P1 (simula lo que T5.1 deberá hacer en producción) | log del paso |
| P3 | `repair 20261015000002 --status applied --local` contra tabla EXISTENTE: filas +1 · conteo de objetos en `public` sin cambios · diff DDL vacío ⇒ **row-only probado** | `p3-repair.log`, `p3-ddl.diff` |
| P4 | `repair 20261015000001 --status reverted --local`: filas -1 ⇒ **reversibilidad probada** | `p4-revert.log` |
| P5 | DDL definitiva + contents + observación de `migration list --local` sin link (alimenta T5.1) | `p5-final-ddl.sql`, `p5-table-def.txt`, `p5-contents.txt`, `p5-migration-list-local.log` |
| P6 | `supabase init` → `config.toml` archivada para que **T4.2** la commitee byte-idéntica | `config.toml` |

Forma de invocación doc-verified (docs `migration-repair`, fetch 2026-10-19): `supabase migration repair [version] ... --status <applied|reverted>` (`--status` REQUIRED) · `--local` = *"Repairs the migration history of the local database"* · *applied* inserta una fila / *reverted* borra una fila (semántica row-only).

## Seguridad por construcción

- `workflow_dispatch` ONLY · **sin `environment:`** · **sin `${{ secrets.* }}`** ⇒ inalcanzable para producción por diseño.
- Stack local desechable (volumen Docker del runner, muere con el job). El único `DROP SCHEMA` apunta a `127.0.0.1:54322` (URL local default documentada por `supabase status`).
- **INV-6/DEV-05**: el harness jamás empuja esquema al proyecto remoto; sin este spike PASS **y** T5.1 verde, no hay push remoto.
- **Nunca** agregar `SUPABASE_ACCESS_TOKEN` a este workflow: si P2 fallara requiriendo link/token aun con `--local`, eso es un *finding* documentado que escala a diseño — no una razón para inyectar credenciales.

## Rúbrica de interpretación (design #507 §2.4 SUCCESS — TODOS required)

| # | Criterio PASS | Dónde observar |
|---|---|---|
| 1 | DDL de la tabla de history en log/artefacto | `p1-schema-migrations.sql` o `p5-final-ddl.sql` + `p*-table-def.txt` |
| 2 | Rama documentada: **A** (repair crea la tabla) o **B** (repair la requiere creada) | VEREDICTO: `BRANCH=A` o `BRANCH=B` |
| 3 | P3 row-only probado (filas +1 · `public` sin cambios · diff DDL vacío) | VEREDICTO: `P3_OK=1` |
| 4 | P4 reversible probado (revert borra la fila) | VEREDICTO: `P4_OK=1` |
| 5 | Log + artefactos archivados | artefacto `spike-u3-repair-baseline` |

## Qué desbloquea un PASS

- **T4.2**: commitear `supabase/config.toml` **byte-idéntica** al artefacto P6 (determinismo; hand-edit prohibido).
- **T5.1** (`baseline-repair`): ejecutar la rama que el spike eligió —
  - **A** = `repair --status applied` ×12 directo (20261015000001 … 20261016000012);
  - **B** = aplicar el DDL del artefacto **antes** del repair ×12;
  - en ambos: re-verificar `migration list` = 12 applied / 0 pending.
- Cierre del registro **U3** (#503) con la evidencia del run.

## FAIL / INCOMPLETO ⇒ T5.1 bloqueado — escalación

1. Derivar la DDL desde el **código fuente del CLI** (`github.com/supabase/cli`) — **NUNCA adivinar** (risk (a)).
2. Si P2 falla requiriendo link/token aun con `--local`: finding documentado → escalar a diseño (el spike jamás obtiene credenciales).

## Lo que el spike NO responde (residual, honesto)

- Comportamiento de `repair` contra el proyecto **remoto** (`--linked`): el spike es local-only por construcción. La semántica row-only está doc-verified para ambos targets (docs `migration-repair`).
- ¿`supabase db start` aplica migraciones? (U-leftover #510): el harness usa `supabase start -x` (el doc de `start` sí muestra *"Applying migration …"*); `schema-check.yml` sigue cubierto por su *presence-assertion*.
- `migration list` sin link: observado y capturado (no asertado) — alimenta el diseño de T5.1.
