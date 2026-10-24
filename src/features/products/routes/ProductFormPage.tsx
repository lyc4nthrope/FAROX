import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../../../app/providers/AuthProvider";
import { mapError } from "../../../shared/lib/errors/mapError";
import {
  createProduct,
  deactivateProduct,
  fetchBrands,
  fetchProduct,
  fetchProductCategories,
  fetchUnitTypes,
  updateProduct,
} from "../api";
import { ProductForm, type ProductFormErrors } from "../components/ProductForm";
import { productSchema, type ProductFormValues } from "../schemas";
import type { CatalogRef } from "../types";

const EMPTY_VALUES: ProductFormValues = {
  name: "",
  description: "",
  brand_id: "",
  unit_type_id: "",
  category_id: "",
  base_quantity: "",
  barcode: "",
};

// Contenedor de /products/new y /products/:id (§S2 fila Product form ·
// PROD-2/PROD-3). Contratos cargantes:
// · Zod valida ANTES de cualquier request — datos inválidos ⇒ cero red
//   (idea:198 "validación Zod en cada formulario", PROD-3).
// · Toda UI de error de mutación pasa por mapError() EN EL CALL SITE
//   (convención B3: los errores de lista ya los mapea useList; los de
//   mutación los mapea quien los recibe — HARD-1, texto crudo jamás).
// · created_by = auth.uid() lo arma la capa api en el create (0002:97) —
//   el contenedor nunca calcula el uid (D2).
// · SIN pre-check de has_scope en el cliente (D2): el operador sin alcance
//   envía el create igual y la policy products_insert (0006:146-149) lo
//   deniega con 42501 real → mensaje amigable, nunca un falso éxito
//   (PROD-2). Ocultar controles es UX nomás (idea:134).
// · Borrar = desactivar (is_active=false) y DESPUÉS purgar, en 2 llamadas
//   secuenciales: la policy products_delete exige la fila inactiva
//   (0006:156-158, "soft → purge" — PROD-2 "delete is admin soft-delete";
//   idea:206 "eliminar = soft-delete (is_active), solo admin"). Si el paso 1
//   falla, el paso 2 NO corre.
// · Éxito ⇒ navigate("/products"): la lista refetchea al re-entrar
//   (HARD-3 sin realtime, D4).
export function ProductFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  // SEC-01 (idea:113): admin y operador escriben; operador "edita solo los
  // suyos" lo resuelve la policy en el backend (0006:150-155) — acá no se
  // filtra ownership en el cliente (D2). distribuidor ⇒ readOnly.
  const canWrite = role === "admin" || role === "operador";
  const isEdit = id !== undefined;
  const productId = id === undefined ? null : Number(id);

  const [values, setValues] = useState<ProductFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [brands, setBrands] = useState<CatalogRef[]>([]);
  const [units, setUnits] = useState<CatalogRef[]>([]);
  const [categories, setCategories] = useState<CatalogRef[]>([]);

  useEffect(() => {
    if (productId !== null && (!Number.isInteger(productId) || productId < 1)) {
      // /products/abc: nunca un crash ni un formulario de alta en una URL de
      // edición — estado "no encontrado" amigable (V0-4, D4).
      setFormError("No se encontró el registro.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        // Los 3 catálogos se piden en paralelo: son lecturas de USING true
        // (0006:66-120) y el formulario no puede poblar sus <select> sin
        // ellas. Un fallo de catálogo ⇒ banner amigable; el submit quedaría
        // bloqueado por Zod (FK vacíos).
        const [brandsResult, unitsResult, categoriesResult] = await Promise.all([
          fetchBrands(),
          fetchUnitTypes(),
          fetchProductCategories(),
        ]);
        if (cancelled) return;
        const catalogError =
          brandsResult.error ?? unitsResult.error ?? categoriesResult.error;
        if (catalogError !== null) {
          setFormError(mapError(catalogError));
        }
        setBrands(brandsResult.rows);
        setUnits(unitsResult.rows);
        setCategories(categoriesResult.rows);
        if (productId === null) return;
        const { row, error } = await fetchProduct(productId);
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
          description: row.description ?? "",
          brand_id: String(row.brand_id),
          unit_type_id: String(row.unit_type_id),
          category_id: String(row.category_id),
          base_quantity: String(row.base_quantity),
          barcode: row.barcode ?? "",
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
  }, [productId]);

  function handleSubmit(): void {
    // URL de edición inválida (/products/abc): nunca emitir un request con un
    // id que no es número (el banner "no encontrado" ya está visible).
    if (productId !== null && !Number.isInteger(productId)) {
      setFormError("No se encontró el registro.");
      return;
    }
    const parsed = productSchema.safeParse(values);
    if (!parsed.success) {
      const issues = parsed.error.flatten();
      setErrors({
        name: issues.fieldErrors.name?.[0],
        description: issues.fieldErrors.description?.[0],
        brand_id: issues.fieldErrors.brand_id?.[0],
        unit_type_id: issues.fieldErrors.unit_type_id?.[0],
        category_id: issues.fieldErrors.category_id?.[0],
        base_quantity: issues.fieldErrors.base_quantity?.[0],
        barcode: issues.fieldErrors.barcode?.[0],
      });
      setFormError(null);
      return; // inválido ⇒ CERO requests (idea:198 / PROD-3)
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const result =
          productId === null
            ? await createProduct(parsed.data)
            : await updateProduct(productId, parsed.data);
        if (result.error !== null) {
          setFormError(mapError(result.error)); // mapError en el call site (B3)
          return;
        }
        navigate("/products");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  function handleDelete(): void {
    if (productId === null || !Number.isInteger(productId)) return;
    const confirmed = window.confirm(
      "¿Desactivar este registro? Quedará desactivado y oculto de las listas; un administrador puede reactivarlo.",
    );
    if (!confirmed) return;
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        // Paso 1: desactivar (la policy de DELETE exige is_active = false).
        const deactivate = await deactivateProduct(productId);
        if (deactivate.error !== null) {
          setFormError(mapError(deactivate.error));
          return;
        }
        navigate("/products");
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <section className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold">{isEdit ? "Producto" : "Nuevo producto"}</h1>
      {loading ? (
        <p className="mt-4 text-sm text-gray-600">Cargando…</p>
      ) : (
        <div className="mt-6">
          <ProductForm
            values={values}
            errors={errors}
            formError={formError}
            saving={saving}
            readOnly={!canWrite}
            canDelete={role === "admin" && isEdit}
            submitLabel={isEdit ? "Guardar cambios" : "Crear producto"}
            brands={brands}
            units={units}
            categories={categories}
            onChange={setValues}
            onSubmit={handleSubmit}
            onDelete={handleDelete}
          />
        </div>
      )}
    </section>
  );
}
