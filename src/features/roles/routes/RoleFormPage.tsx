import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { mapError } from "../../../shared/lib/errors/mapError";
import { createRole, deleteRole, fetchRole, updateRole } from "../api";
import { RoleForm, type RoleFormErrors } from "../components/RoleForm";
import { roleSchema, type RoleFormState } from "../schemas";
import { esRolSemilla } from "../types";

const EMPTY_VALUES: RoleFormState = { name: "", description: "" };

// Contenedor de /roles/new y /roles/:id (sdd/admin-console T-C3, ADM-8).
// Contratos:
// · Zod valida ANTES de cualquier request — name = z.enum(ROLE_NAMES) (R3):
//   «superuser» o vacío ⇒ CERO invocaciones del api y copy de la guarda
//   visible (ADM-8.2, mitigación R3 del design #599 §6).
// · Los 3 roles semilla (0005:18-22 ⇒ ROLE_NAMES) no se pueden renombrar
//   (name deshabilitado) NI borrar (sin botón) — ADM-8.5.
// · Borrar un rol en uso ⇒ FK RESTRICT 23503 REAL del server traducido por
//   mapError a «Este registro está en uso y no se puede eliminar.» y el
//   formulario permanece (ADM-8.4, HARD-1: jamás texto crudo).
export function RoleFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = id !== undefined;
  const roleId = id === undefined ? null : Number(id);

  const [values, setValues] = useState<RoleFormState>(EMPTY_VALUES);
  // Nombre ORIGINAL de la fila cargada: la condición de semilla (ADM-8.5) se
  // decide con ESTE valor, nunca con el valor en edición — si no, tipear un
  // nombre de semilla en un rol legacy bloquearía el campo a mitad de edición.
  const [nombreOriginal, setNombreOriginal] = useState<string | null>(null);
  const [errors, setErrors] = useState<RoleFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingRow, setLoadingRow] = useState(isEdit);

  useEffect(() => {
    if (roleId === null) return;
    if (!Number.isInteger(roleId) || roleId < 1) {
      // /roles/abc: nunca un crash ni un formulario de alta en una URL de
      // edición — estado "no encontrado" amigable (V0-4, D4).
      setFormError("No se encontró el registro.");
      setLoadingRow(false);
      return;
    }
    let cancelled = false;
    setLoadingRow(true);
    void (async () => {
      try {
        const { row, error } = await fetchRole(roleId);
        if (cancelled) return;
        if (error !== null) {
          setFormError(mapError(error));
          return;
        }
        if (row === null) {
          setFormError("No se encontró el registro.");
          return;
        }
        setValues({ name: row.name, description: row.description ?? "" });
        setNombreOriginal(row.name);
      } catch (thrown) {
        if (!cancelled) setFormError(mapError(thrown));
      } finally {
        if (!cancelled) setLoadingRow(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roleId]);

  // ADM-8.5: el nombre solo se puede deshabilitar cuando YA se cargó la fila
  // y esa fila es semilla (nombre original ∈ ROLE_NAMES). En alta nunca está
  // deshab.
  const esFilaSemilla =
    nombreOriginal !== null && loadingRow === false && esRolSemilla(nombreOriginal);
  // C0.4: los roles son fijos del sistema; en edición solo cambia la descripción.
  const nombreDeshabilitado = esFilaSemilla || roleId !== null;

  function handleSubmit(): void {
    // URL de edición inválida (/roles/abc): nunca emitir un request.
    if (roleId !== null && !Number.isInteger(roleId)) {
      setFormError("No se encontró el registro.");
      return;
    }
    // R3 (ADM-8.2): name ∉ ROLE_NAMES o vacío ⇒ Zod bloquea, CERO requests.
    const parsed = roleSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        name: issues.fieldErrors.name?.[0],
        description: issues.fieldErrors.description?.[0],
      });
      setFormError(null);
      return;
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const result =
          roleId === null
            ? await createRole(parsed.data)
            : await updateRole(roleId, parsed.data);
        if (result.error !== null) {
          setFormError(mapError(result.error)); // mapError en el call site (HARD-1)
          return;
        }
        navigate("/roles");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  // ADM-8.4: borrado SOLO para roles no semilla. 23503 (FK RESTRICT del
  // server) ⇒ banner amigable y el formulario permanece (la fila sigue).
  function handleDelete(): void {
    if (roleId === null || !Number.isInteger(roleId)) return;
    if (esFilaSemilla) return; // doble guarda: la UI ya oculta el botón
    const confirmed = window.confirm(
      "¿Eliminar este rol? Si tiene usuarios asignados no se va a poder borrar.",
    );
    if (!confirmed) return;
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const { error } = await deleteRole(roleId);
        if (error !== null) {
          setFormError(mapError(error));
          return;
        }
        navigate("/roles");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <section className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">
        {isEdit ? "Rol" : "Nuevo rol"}
      </h1>
      {loadingRow ? (
        <p className="mt-4 text-sm text-gray-600">Cargando…</p>
      ) : (
        <div className="mt-6">
          <RoleForm
            values={values}
            errors={errors}
            formError={formError}
            notice={null}
            saving={saving}
            nombreDeshabilitado={nombreDeshabilitado}
            onDelete={
              nombreOriginal !== null && !esFilaSemilla ? handleDelete : undefined
            }
            onChange={setValues}
            onSubmit={handleSubmit}
          />
        </div>
      )}
    </section>
  );
}
