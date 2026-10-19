import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { mapError } from "../../../shared/lib/errors/mapError";
import {
  createStore,
  deactivateStore,
  deleteStore,
  fetchStore,
  fetchStoreGeo,
  fetchStoreTypes,
  updateStore,
} from "../api";
import { StoreForm, type StoreFormErrors } from "../components/StoreForm";
import { storeSchema, type StoreFormValues } from "../schemas";
import type { StoreTypeRef } from "../types";

const EMPTY_VALUES: StoreFormValues = {
  name: "",
  store_type_id: "",
  address: "",
  city: "",
  phone: "",
  lat: "",
  lng: "",
};

// Contenedor de /stores/new y /stores/:id (§S2 fila Store form · STORE-1 y
// STORE-3, spec #483 S6). Contratos cargantes:
// · Zod valida ANTES de cualquier request — coordenadas vacías o fuera de
//   rango ⇒ cero red (idea:198; STORE-1 "coordinates omitted blocked
//   client-side": stores.location NOT NULL (0002:131) vs p_location DEFAULT
//   NULL (0004:641) ⇒ omitirlas sería un not_null_violation crudo).
// · El ALTA pasa SOLO por rpc create_store (STORE-1; INSERT revocado 0006:360)
//   — el contenedor no arma ningún insert: la capa api decide el camino.
// · La EDICIÓN es UPDATE directo por policy stores_update (admin o creador
//   con has_scope — 0006:166-171); un operador editando tienda ajena recibe
//   0 filas ⇒ api sintetiza 42501 ⇒ mensaje amigable, nunca un falso éxito
//   (STORE-3 escenario "non-owned denied"). Sin pre-check de ownership en el
//   cliente (D2): la DB manda (idea:134).
// · Toda UI de error de mutación pasa por mapError() EN EL CALL SITE
//   (convención B3/HARD-1): D34 (tope), "store_type inexistente", 23502
//   (not_null de location) y 42501 quedan cubiertos por el mapa de D5.
// · Borrar = desactivar (is_active=false) y DESPUÉS purgar, en 2 llamadas
//   secuenciales: stores_delete exige la fila inactiva (0006:172-174 —
//   STORE-3 "deactivate-then-delete"). Si el paso 1 falla, el paso 2 NO corre.
// · Éxito ⇒ navigate("/stores"): la lista refetchea al re-entrar (HARD-3 sin
//   realtime, D4).
export function StoreFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  // SEC-01 (idea:114): admin y operador escriben (crear/editar sus tiendas);
  // "sus" lo resuelve la policy en el backend (0006:166-171) — acá no se
  // filtra ownership en el cliente (D2).
  const canWrite = role === "admin" || role === "operador";
  const isEdit = id !== undefined;
  const storeId = id === undefined ? null : Number(id);

  const [values, setValues] = useState<StoreFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<StoreFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [storeTypes, setStoreTypes] = useState<StoreTypeRef[]>([]);

  useEffect(() => {
    if (storeId !== null && (!Number.isInteger(storeId) || storeId < 1)) {
      // /stores/abc: nunca un crash ni un formulario de alta en una URL de
      // edición — estado "no encontrado" amigable (V0-4, D4).
      setFormError("No se encontró el registro.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        // El catálogo store_types alimenta el <select> en alta Y edición
        // (lectura USING true, 0006:76-77). Un fallo de catálogo ⇒ banner
        // amigable; el submit quedaría bloqueado por Zod (tipo vacío).
        const typesResult = await fetchStoreTypes();
        if (cancelled) return;
        if (typesResult.error !== null) {
          setFormError(mapError(typesResult.error));
        }
        setStoreTypes(typesResult.rows);
        if (storeId === null) return;
        // Edición: la fila viene de la tabla stores y las coordenadas de
        // stores_geo (STORE-2: lat/lng SIEMPRE de la vista, jamás de la
        // columna location ni computadas en el cliente — Base:165).
        const [storeResult, geoResult] = await Promise.all([
          fetchStore(storeId),
          fetchStoreGeo(storeId),
        ]);
        if (cancelled) return;
        const loadError = storeResult.error ?? geoResult.error;
        if (loadError !== null) {
          setFormError(mapError(loadError));
          return;
        }
        if (storeResult.row === null || geoResult.geo === null) {
          setFormError("No se encontró el registro.");
          return;
        }
        setValues({
          name: storeResult.row.name,
          store_type_id: String(storeResult.row.store_type_id),
          address: storeResult.row.address ?? "",
          city: storeResult.row.city ?? "",
          phone: storeResult.row.phone ?? "",
          lat: String(geoResult.geo.lat),
          lng: String(geoResult.geo.lng),
        });
      } catch (thrown) {
        if (!cancelled) setFormError(mapError(thrown));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  function handleSubmit(): void {
    // URL de edición inválida (/stores/abc): nunca emitir un request con un
    // id que no es número (el banner "no encontrado" ya está visible).
    if (storeId !== null && !Number.isInteger(storeId)) {
      setFormError("No se encontró el registro.");
      return;
    }
    const parsed = storeSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        name: issues.fieldErrors.name?.[0],
        store_type_id: issues.fieldErrors.store_type_id?.[0],
        lat: issues.fieldErrors.lat?.[0],
        lng: issues.fieldErrors.lng?.[0],
      });
      setFormError(null);
      return; // inválido ⇒ CERO requests (idea:198 / STORE-1)
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        // create = rpc create_store (EWKT lng-first, D3); update = UPDATE por
        // policy. Ambos devuelven el error CRUDO: acá se mapea (HARD-1).
        const result =
          storeId === null
            ? await createStore(parsed.data)
            : await updateStore(storeId, parsed.data);
        if (result.error !== null) {
          setFormError(mapError(result.error)); // mapError en el call site (B3)
          return;
        }
        navigate("/stores");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  function handleDelete(): void {
    if (storeId === null || !Number.isInteger(storeId)) return;
    const confirmed = window.confirm(
      "¿Eliminar esta tienda? Primero queda desactivada y después se borra.",
    );
    if (!confirmed) return;
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        // Paso 1: desactivar (la policy de DELETE exige is_active = false).
        const deactivate = await deactivateStore(storeId);
        if (deactivate.error !== null) {
          setFormError(mapError(deactivate.error));
          return;
        }
        // Paso 2: purgar la fila YA desactivada (0006:172-174).
        const remove = await deleteStore(storeId);
        if (remove.error !== null) {
          setFormError(mapError(remove.error));
          return;
        }
        navigate("/stores");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <section className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">{isEdit ? "Tienda" : "Nueva tienda"}</h1>
      {loading ? (
        <p className="mt-4 text-sm text-gray-600">Cargando…</p>
      ) : (
        <div className="mt-6">
          <StoreForm
            values={values}
            errors={errors}
            formError={formError}
            saving={saving}
            readOnly={!canWrite}
            canDelete={role === "admin" && isEdit}
            submitLabel={isEdit ? "Guardar cambios" : "Crear tienda"}
            storeTypes={storeTypes}
            onChange={setValues}
            onSubmit={handleSubmit}
            onDelete={handleDelete}
          />
        </div>
      )}
    </section>
  );
}
