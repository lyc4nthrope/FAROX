import { StoreCatalogPanel } from "../components/StoreCatalogPanel";

/**
 * /products para el distribuidor. Reutiliza el MISMO panel de productos de la
 * tienda (buscador, filtros, tabla, alta y acciones) en modo «distribuidor»:
 * sin stock/umbral/precio, con el estado «En catálogo».
 */
export function DistributorCatalogPage() {
  return (
    <section>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
        Catálogo
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Productos</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-500">
        Los productos que ofrecés a las tiendas vinculadas. Agregalos desde el registro y quitá los
        que ya no manejes.
      </p>
      <div className="mt-5 rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm sm:p-5">
        <StoreCatalogPanel kind="distribuidor" storeId={0} storeName="mi distribuidora" />
      </div>
    </section>
  );
}
