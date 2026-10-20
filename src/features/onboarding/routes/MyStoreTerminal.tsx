import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { mapError } from "../../../shared/lib/errors/mapError";
import { useReverseGeocode } from "../../../shared/lib/geo/useReverseGeocode";
import type { GeoCoords } from "../../../shared/lib/geo/useGeolocation";
import { createStore, fetchStoreTypes } from "../api";
import { useOnboarding } from "../context";
import { MyStoreSetupForm, type MyStoreFormErrors } from "../components/MyStoreSetupForm";
import { myStoreSchema, type MyStoreValues } from "../schemas";
import type { StoreTypeOption } from "../types";

const EMPTY_VALUES: MyStoreValues = {
  name: "",
  store_type_id: "",
  lat: "",
  lng: "",
  address: "",
};

// Contenedor de la terminal [Mi tienda] (S-D3.B · T2.5): alta MÍNIMA por la
// RPC create_store (mismo camino RPC-only que B7 — STORE-1). Ubicación
// OBLIGATORIA validada por Zod en el cliente (idea:198; stores.location NOT
// NULL 0002:131) + defense-in-depth del guard server de 0013(a) post-H1. La
// ubicación se elige en el MAPA (supersede del D3 de #486): cada pin dispara
// el reverse geocode diferido (~800ms) cuyo resultado viaja a p_address
// (best-effort — si Nominatim falla, NULL y el alta NO se bloquea).
// Éxito ⇒ create_store auto-asocia al dueño en user_stores (D35,
// 0004:661-663) ⇒ refresh() re-deriva la señal my_store_ids() y el guard
// deja de preguntar antes de navegar a "/" (S-D3.B AC).
export function MyStoreTerminal({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const { refresh } = useOnboarding();

  const [values, setValues] = useState<MyStoreValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<MyStoreFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [storeTypes, setStoreTypes] = useState<StoreTypeOption[]>([]);

  // Pipeline único de reverse geocode del pin (cancellable, montaje-safe).
  const { schedule: scheduleAddressResolution } = useReverseGeocode((address) => {
    setValues((previous) => ({ ...previous, address }));
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Catálogo store_types (lectura USING true, 0006:76-77). Fallo de
        // catálogo ⇒ banner amigable; el submit quedaría bloqueado por Zod
        // (tipo vacío).
        const result = await fetchStoreTypes();
        if (cancelled) return;
        if (result.error !== null) {
          setFormError(mapError(result.error));
        }
        setStoreTypes(result.rows);
      } catch (thrown) {
        if (!cancelled) setFormError(mapError(thrown));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ÚNICA vía de mutación de coordenadas: el mapa emita y el form queda con
  // strings (mismo shape que los inputs legacy del escape hatch). El reverse
  // geocode corre en paralelo, diferido y best-effort.
  function handleLocationChange(next: GeoCoords): void {
    setValues((previous) => ({
      ...previous,
      lat: String(next.latitude),
      lng: String(next.longitude),
    }));
    scheduleAddressResolution(next);
  }

  function handleSubmit(): void {
    const parsed = myStoreSchema.safeParse(values);
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
        const result = await createStore(parsed.data);
        if (result.error !== null) {
          setFormError(mapError(result.error)); // mapError en el call site (B3)
          return;
        }
        await refresh();
        navigate("/");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <section className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">Creá tu tienda</h1>
      <p className="mt-2 text-sm text-gray-600">
        Empezá con lo mínimo: nombre, tipo y ubicación. Un administrador puede auditar o
        revertir esta alta después.
      </p>
      <div className="mt-6">
        {loading ? (
          <p role="status" className="text-sm text-gray-600">
            Cargando tipos de tienda…
          </p>
        ) : (
          <MyStoreSetupForm
            values={values}
            errors={errors}
            formError={formError}
            saving={saving}
            storeTypes={storeTypes}
            onChange={setValues}
            onLocationChange={handleLocationChange}
            onSubmit={handleSubmit}
            onBack={onBack}
          />
        )}
      </div>
    </section>
  );
}
