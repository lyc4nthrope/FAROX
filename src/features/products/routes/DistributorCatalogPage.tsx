import { useAuth } from "../../../app/providers/AuthProvider";
import { StoreCatalogPanel } from "../components/StoreCatalogPanel";

/**
 * /products para el distribuidor. Reutiliza el MISMO panel de productos de la
 * tienda en modo «distribuidor»: busca, filtra, agrega y edita SU relación con
 * el producto (cantidad y precios), nunca la ficha global (0030).
 */
export function DistributorCatalogPage() {
  const { premium } = useAuth();
  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
        Catálogo
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Productos</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Los productos que ofrecés a las tiendas vinculadas. Ajustá tu cantidad y tus precios; la
        ficha del producto la administra el administrador.
      </p>
      <div className="mt-5 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm sm:p-5">
        <StoreCatalogPanel
          kind="distribuidor"
          storeId={0}
          storeName="mi distribuidora"
          canSetPrice={premium}
        />
      </div>
    </section>
  );
}
