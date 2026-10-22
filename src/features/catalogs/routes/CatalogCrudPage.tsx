import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { NotFound } from "../../../app/NotFound";
import { useList } from "../../../shared/hooks/useList";
import { mapError } from "../../../shared/lib/errors/mapError";
import type { ListResult } from "../../../shared/lib/list";
import {
  createCatalogRow,
  deactivateCatalogRow,
  deleteCatalogRow,
  fetchCatalogRows,
  updateCatalogRow,
} from "../api";
import { CatalogForm } from "../components/CatalogForm";
import { CatalogTable } from "../components/CatalogTable";
import { getCatalogDefinition, type CatalogDefinition } from "../definitions";
import type { CatalogFormErrors, CatalogFormValues } from "../schemas";
import type { CatalogRow, ParentOption } from "../types";

// Contenedor genérico de /catalogs/:catalogKey (sdd/admin-console T-C4/T-C6,
// design key-decision #4). UNA sola pantalla para las 4 tablas: la variación
// (columnas, schema, deleteMode) vive en definitions.ts (D-M1). Key inválida
// ⇒ <NotFound/> (design #599 §1, app/NotFound.tsx).
// Contratos: Zod ANTES de cualquier request (ADM-9.5 ⇒ cero red), toda UI
// de error por mapError() (HARD-1), refetch tras mutación (HARD-3 sin
// realtime), y el deleteMode de cada tabla dictado por SU policy:
// · brands = soft-two-step: «Desactivar» (0006:95-97) y «Eliminar» solo
//   sobre filas ya inactivas (ADM-9.2);
// · unit_types / store_types / product_categories = HARD admin
//   (0006:73-74 / 83-84 / 119-120); FK RESTRICT ⇒ 23503 amigable (ADM-9.4).
export function CatalogCrudPage() {
  const { catalogKey } = useParams<{ catalogKey: string }>();
  const definition =
    catalogKey === undefined ? undefined : getCatalogDefinition(catalogKey);
  if (definition === undefined) {
    // Los hooks viven en el screen interno: esta rama no los invoca.
    return <NotFound />;
  }
  return <CatalogCrudScreen definition={definition} />;
}

function valoresVacios(definition: CatalogDefinition): CatalogFormValues {
  const vacios: CatalogFormValues = {};
  for (const field of definition.fields) {
    vacios[field.key] = "";
  }
  return vacios;
}

// Fila → valores del form: SOLO las keys de los fields de la definition
// (config-driven); null/undefined ⇒ "". is_active NUNCA es campo del form
// (muta solo por «Desactivar», ADM-9.2) e id tampoco.
function filaAValores(
  definition: CatalogDefinition,
  row: CatalogRow,
): CatalogFormValues {
  const raw = row as unknown as Record<string, unknown>;
  const valores: CatalogFormValues = {};
  for (const field of definition.fields) {
    const value = raw[field.key];
    valores[field.key] =
      value === null || value === undefined ? "" : String(value);
  }
  return valores;
}

function CatalogCrudScreen({ definition }: { definition: CatalogDefinition }) {
  // Listado vía useList (D4): fetcher ESTABLE por definition ⇒ refetch al
  // re-entrar y tras cada mutación, sin realtime. Sin paginación renderizada:
  // los catálogos son chicos (count = filas traídas).
  const fetcher = useCallback(
    (): Promise<ListResult<CatalogRow>> => fetchCatalogRows(definition),
    [definition],
  );
  const list = useList<CatalogRow>(fetcher);

  const [values, setValues] = useState<CatalogFormValues>(() =>
    valoresVacios(definition),
  );
  const [editId, setEditId] = useState<number | null>(null);
  const [errors, setErrors] = useState<CatalogFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Opciones del picker «categoría padre»: salen del MISMO listado (son las
  // categorías), sin query extra. Se excluye la fila en edición (un padre no
  // puede ser uno mismo).
  const parentOptions: ParentOption[] = list.rows
    .filter((row) => row.id !== editId)
    .map((row) => ({ id: row.id, name: row.name }));

  function limpiarForm(): void {
    setValues(valoresVacios(definition));
    setEditId(null);
    setErrors({});
    setFormError(null);
  }

  function handleEdit(row: CatalogRow): void {
    setEditId(row.id);
    setValues(filaAValores(definition, row));
    setErrors({});
    setFormError(null);
  }

  // ADM-9.5 · Zod ANTES de cualquier request: name vacío (o campo faltante)
  // en CUALQUIERA de las 4 pantallas ⇒ errores inline y CERO invocaciones.
  function handleSubmit(): void {
    const parsed = definition.schema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors(issues.fieldErrors as CatalogFormErrors);
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const payload = definition.toDbRow(parsed.data);
        const result =
          editId === null
            ? await createCatalogRow(definition.key, payload)
            : await updateCatalogRow(definition.key, editId, payload);
        if (result.error !== null) {
          setFormError(mapError(result.error)); // 23505 ⇒ «Ya existe…» (T-B1)
          return;
        }
        limpiarForm();
        list.refetch(); // HARD-3: la tabla refleja el cambio tras refetch (ADM-9.1)
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  // HARD delete (y paso 2 del two-step): 23503 (FK RESTRICT) ⇒ banner
  // amigable y la fila permanece (ADM-9.4, HARD-1).
  function handleDelete(row: CatalogRow): void {
    const confirmed = window.confirm(
      "¿Eliminar este registro? Si está en uso no se va a poder borrar.",
    );
    if (!confirmed) return;
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const { error } = await deleteCatalogRow(definition.key, row.id);
        if (error !== null) {
          setFormError(mapError(error));
          return;
        }
        if (editId === row.id) limpiarForm();
        list.refetch();
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  // Paso 1 del two-step de brands (ADM-9.2 · policy 0006:95-97): is_active =
  // false y la fila SIGUE listada como «Inactivo» — el DELETE recién se
  // ofrece sobre filas ya desactivadas (visibility en CatalogTable).
  function handleDeactivate(row: CatalogRow): void {
    const confirmed = window.confirm(
      "¿Desactivar este registro? Sigue listado como inactivo.",
    );
    if (!confirmed) return;
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const { error } = await deactivateCatalogRow(definition.key, row.id);
        if (error !== null) {
          setFormError(mapError(error));
          return;
        }
        list.refetch();
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <section>
      <Link to="/catalogs" className="text-sm text-gray-600 underline">
        ← Volver a Catálogos
      </Link>
      <h1 className="mt-3 text-xl font-semibold">{definition.label}</h1>
      <div className="mt-3">
        <h2 className="text-lg font-semibold">
          {editId === null ? "Nuevo registro" : "Editando registro"}
        </h2>
        <CatalogForm
          definition={definition}
          values={values}
          errors={errors}
          formError={formError}
          saving={saving}
          parentOptions={parentOptions}
          onCancelEdit={editId === null ? undefined : limpiarForm}
          onChange={setValues}
          onSubmit={handleSubmit}
        />
      </div>
      <CatalogTable
        definition={definition}
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onDeactivate={handleDeactivate}
      />
    </section>
  );
}
