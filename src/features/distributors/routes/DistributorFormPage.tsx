import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { mapError } from "../../../shared/lib/errors/mapError";
import {
  createDistributor,
  deactivateDistributor,
  deleteDistributor,
  fetchDistributor,
  updateDistributor,
} from "../api";
import { DistributorForm, type DistributorFormErrors } from "../components/DistributorForm";
import { distributorSchema, type DistributorFormValues } from "../schemas";

const EMPTY_VALUES: DistributorFormValues = {
  name: "",
  nit: "",
  contact_name: "",
  phone: "",
  email: "",
  contact_preference: "whatsapp",
};

// Contenedor de /distributors/new y /distributors/:id (§S2 fila Distributor
// form · DIST-01). Contratos cargantes:
// · Zod valida ANTES de cualquier request — datos inválidos ⇒ cero red
//   (idea:198 "validación Zod en cada formulario"; mismo patrón que PROD-3).
// · Toda UI de error de mutación pasa por mapError() EN EL CALL SITE
//   (convención B3: los errores de lista ya los mapea useList; los de
//   mutación los mapea quien los recibe — HARD-1, texto crudo jamás).
// · Borrar = desactivar (is_active=false) y DESPUÉS borrar, en 2 llamadas
//   secuenciales: la policy distributors_delete exige la fila inactiva
//   (0006:133-135). Si el paso 1 falla, el paso 2 NO corre.
// · Éxito ⇒ navigate("/distributors"): la lista refetchea al re-entrar
//   (HARD-3 sin realtime, D4).
export function DistributorFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const isEdit = id !== undefined;
  const distributorId = id === undefined ? null : Number(id);

  const [values, setValues] = useState<DistributorFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<DistributorFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingRow, setLoadingRow] = useState(isEdit);

  useEffect(() => {
    if (distributorId === null) return;
    if (!Number.isInteger(distributorId) || distributorId < 1) {
      // /distributors/abc: nunca un crash ni un formulario de alta en una
      // URL de edición — estado "no encontrado" amigable (V0-4, D4).
      setFormError("No se encontró el registro.");
      setLoadingRow(false);
      return;
    }
    let cancelled = false;
    setLoadingRow(true);
    void (async () => {
      try {
        const { row, error } = await fetchDistributor(distributorId);
        if (cancelled) return;
        if (error !== null) {
          setFormError(mapError(error));
          return;
        }
        if (row === null) {
          setFormError("No se encontró el registro.");
          return;
        }
        setValues({
          name: row.name,
          nit: row.nit,
          contact_name: row.contact_name ?? "",
          phone: row.phone ?? "",
          email: row.email ?? "",
          contact_preference: row.contact_preference,
        });
      } catch (thrown) {
        if (!cancelled) setFormError(mapError(thrown));
      } finally {
        if (!cancelled) setLoadingRow(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [distributorId]);

  function handleSubmit(): void {
    // URL de edición inválida (/distributors/abc): nunca emitir un request
    // con un id que no es número (el banner "no encontrado" ya está visible).
    if (distributorId !== null && !Number.isInteger(distributorId)) {
      setFormError("No se encontró el registro.");
      return;
    }
    const parsed = distributorSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        name: issues.fieldErrors.name?.[0],
        nit: issues.fieldErrors.nit?.[0],
        contact_name: issues.fieldErrors.contact_name?.[0],
        phone: issues.fieldErrors.phone?.[0],
        email: issues.fieldErrors.email?.[0],
        contact_preference: issues.fieldErrors.contact_preference?.[0],
      });
      setFormError(null);
      return; // inválido ⇒ CERO requests (idea:198 / patrón PROD-3)
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const result =
          distributorId === null
            ? await createDistributor(parsed.data)
            : await updateDistributor(distributorId, parsed.data);
        if (result.error !== null) {
          setFormError(mapError(result.error)); // mapError en el call site (B3)
          return;
        }
        navigate("/distributors");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  function handleDelete(): void {
    if (distributorId === null || !Number.isInteger(distributorId)) return;
    const confirmed = window.confirm(
      "¿Eliminar este distribuidor? Primero queda desactivado y después se borra.",
    );
    if (!confirmed) return;
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        // Paso 1: desactivar (la policy de DELETE exige is_active = false).
        const deactivate = await deactivateDistributor(distributorId);
        if (deactivate.error !== null) {
          setFormError(mapError(deactivate.error));
          return;
        }
        // Paso 2: borrar la fila YA desactivada (0006:133-135).
        const remove = await deleteDistributor(distributorId);
        if (remove.error !== null) {
          setFormError(mapError(remove.error));
          return;
        }
        navigate("/distributors");
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
        {isEdit ? "Distribuidor" : "Nuevo distribuidor"}
      </h1>
      {loadingRow ? (
        <p className="mt-4 text-sm text-gray-600">Cargando…</p>
      ) : (
        <div className="mt-6">
          <DistributorForm
            values={values}
            errors={errors}
            formError={formError}
            saving={saving}
            readOnly={!isAdmin}
            canDelete={isAdmin && isEdit}
            submitLabel={isEdit ? "Guardar cambios" : "Crear distribuidor"}
            onChange={setValues}
            onSubmit={handleSubmit}
            onDelete={handleDelete}
          />
        </div>
      )}
    </section>
  );
}
