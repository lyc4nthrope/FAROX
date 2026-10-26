import { useEffect, useState } from "react";

import { useList } from "../../../shared/hooks/useList";
import { useLoad, type LoadResult } from "../../../shared/hooks/useLoad";
import { PAGE_SIZE } from "../../../shared/lib/list";
import { mapError } from "../../../shared/lib/errors/mapError";
import {
  Box,
  Status,
  buttonClass,
  inputClass,
  runAction,
} from "../../../shared/ui/Box";
import { Pager } from "../../../shared/ui/Pager";
import {
  addDistributorCatalogProduct,
  addStoreCatalogProduct,
  createProduct,
  fetchActiveProductsForCatalog,
  fetchBrands,
  fetchProductCategories,
  fetchUnitTypes,
} from "../api";
import { ProductForm, type ProductFormErrors } from "./ProductForm";
import { ProductList } from "./ProductList";
import { productSchema, type ProductFormValues } from "../schemas";
import type { CatalogQuery, CatalogRef, CatalogTarget, ProductListRow } from "../types";

interface Msg {
  error: string | null;
  ok: string | null;
}

const NO_MSG: Msg = { error: null, ok: null };

const INITIAL_QUERY: CatalogQuery = {
  page: 0,
  pageSize: PAGE_SIZE,
  q: "",
  categoryId: null,
  onlyShortage: false,
};

const EMPTY_VALUES: ProductFormValues = {
  name: "",
  description: "",
  brand_id: "",
  unit_type_id: "",
  category_id: "",
  base_quantity: "",
  barcode: "",
};

// Los catálogos del formulario devuelven { rows, error }; useLoad espera
// { data, error }. El adaptador vive acá para no cambiar la api por la UI.
function asCatalogLoader(
  fetcher: () => Promise<{ rows: CatalogRef[]; error: { message: string } | null }>,
): () => Promise<LoadResult<CatalogRef[]>> {
  return async () => {
    const result = await fetcher();
    return { data: result.rows, error: result.error };
  };
}

/**
 * Alta rápida (S9): crea el producto en el registro global y lo asigna a la
 * entidad en un solo paso. Reutiliza el `ProductForm` y el `productSchema` de
 * siempre — un formulario menos no justifica otro componente.
 * Se monta solo cuando el usuario lo abre: los 3 catálogos de FK se piden acá,
 * no en la carga del catálogo.
 */
function QuickCreateProduct({
  target,
  onCreated,
  onCancel,
  onError,
}: {
  target: CatalogTarget;
  onCreated: () => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [values, setValues] = useState<ProductFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const brands = useLoad(asCatalogLoader(fetchBrands), []);
  const units = useLoad(asCatalogLoader(fetchUnitTypes), []);
  const categories = useLoad(asCatalogLoader(fetchProductCategories), []);
  const catalogsError = brands.error ?? units.error ?? categories.error;

  function handleSubmit(): void {
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
      return; // inválido ⇒ CERO requests
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    void (async () => {
      try {
        const created = await createProduct(parsed.data);
        if (created.error !== null) {
          setFormError(mapError(created.error));
          return;
        }
        const productId = created.id;
        if (productId === null) {
          setFormError("No se pudo confirmar el producto creado. Probá de nuevo.");
          return;
        }
        const added = await runAction(() =>
          target.kind === "store"
            ? addStoreCatalogProduct(target.id, productId)
            : addDistributorCatalogProduct(productId),
        );
        onCreated();
        if (added !== null) {
          // El producto YA existe en el registro: se cierra el alta igual y se
          // avisa acá; el usuario puede sumarlo desde la lista con «Agregar».
          onError(added);
        }
      } catch (thrown) {
        setFormError(mapError(thrown));
      } finally {
        setSaving(false);
      }
    })();
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">Producto nuevo</h3>
      {catalogsError !== null && <Status error={catalogsError} />}
      <ProductForm
        values={values}
        errors={errors}
        formError={formError}
        saving={saving}
        readOnly={brands.loading || units.loading || categories.loading}
        canDelete={false}
        submitLabel="Crear y agregar"
        brands={brands.data ?? []}
        units={units.data ?? []}
        categories={categories.data ?? []}
        onChange={setValues}
        onSubmit={handleSubmit}
        onDelete={() => undefined}
      />
      <button className={`mt-3 ${buttonClass}`} type="button" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

/**
 * Registro global (solo activos) para sumar productos a la entidad elegida.
 * La búsqueda y la categoría se resuelven en el SERVIDOR (S3/S8): con cientos
 * de productos, filtrar solo la página cargada escondería el resto del
 * registro y haría imposible agregar un producto que no esté en la página.
 */
export function AddProductsPanel({
  target,
  categories,
  onAdded,
}: {
  target: CatalogTarget;
  categories: CatalogRef[];
  onAdded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg>(NO_MSG);

  const list = useList<ProductListRow, CatalogQuery>(fetchActiveProductsForCatalog, INITIAL_QUERY);

  const activeSearch = list.query.q;
  const setQuery = list.setQuery;
  useEffect(() => {
    if (search === activeSearch) return;
    const timer = setTimeout(() => setQuery({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, activeSearch, setQuery]);

  async function agregar(product: ProductListRow): Promise<void> {
    setBusyId(product.id);
    const error = await runAction(() =>
      target.kind === "store"
        ? addStoreCatalogProduct(target.id, product.id)
        : addDistributorCatalogProduct(product.id),
    );
    setMsg({ error, ok: error === null ? "Producto agregado al catálogo." : null });
    if (error === null) onAdded();
    setBusyId(null);
  }

  return (
    <Box title="Agregar productos a mi catálogo">
      <Status error={msg.error} ok={msg.ok} />

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-xs">
          <label htmlFor="registry-search" className="block text-sm font-medium text-gray-700">
            Buscar en el registro
          </label>
          <input
            id="registry-search"
            className={`mt-1 w-full ${inputClass}`}
            type="search"
            placeholder="Nombre del producto…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="w-full max-w-xs">
          <label htmlFor="registry-category" className="block text-sm font-medium text-gray-700">
            Categoría del registro
          </label>
          <select
            id="registry-category"
            className={`mt-1 w-full ${inputClass}`}
            value={list.query.categoryId === null ? "" : String(list.query.categoryId)}
            onChange={(event) =>
              list.setQuery({
                categoryId: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          >
            <option value="">Todas</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className={buttonClass}
          type="button"
          onClick={() => setCreating((open) => !open)}
        >
          {creating ? "Cerrar producto nuevo" : "Crear producto nuevo"}
        </button>
      </div>

      {creating && (
        <QuickCreateProduct
          target={target}
          onCreated={() => {
            setCreating(false);
            list.refetch();
            onAdded();
          }}
          onCancel={() => setCreating(false)}
          onError={(message) => setMsg({ error: message, ok: null })}
        />
      )}

      <ProductList
        rows={list.rows}
        loading={list.loading}
        error={list.error}
        emptyTitle="No hay productos que coincidan con la búsqueda"
        emptyHint="Probá con otro nombre, otra categoría o pasá a la página siguiente."
        renderAction={(row) => (
          <button
            className={buttonClass}
            type="button"
            disabled={busyId === row.id}
            onClick={() => void agregar(row)}
          >
            Agregar
          </button>
        )}
      />
      <Pager list={list} />
    </Box>
  );
}
