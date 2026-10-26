import { useEffect, useState } from "react";

import { useLoad } from "../../../shared/hooks/useLoad";
import { Field, Status, inputClass } from "../../../shared/ui/Box";
import { StoreLinkPanel } from "../../store-links";
import { fetchMyStoreOptions } from "../../store-links/api";

// /distributors para el operador: sus tiendas, sus distribuidores vinculados y
// el código/QR para vincular uno nuevo. El admin sigue usando la lista global.
export function MyDistributorsPage() {
  const stores = useLoad(fetchMyStoreOptions, []);
  const [storeId, setStoreId] = useState("");

  useEffect(() => {
    if (storeId !== "" || stores.data === null || stores.data.length === 0) return;
    setStoreId(String(stores.data[0].id));
  }, [storeId, stores.data]);

  return (
    <section>
      <h1 className="text-xl font-semibold">Distribuidores</h1>
      <p className="mt-1 text-sm text-gray-600">
        Estos son los distribuidores vinculados a tus tiendas. Para vincular uno nuevo, compartí el
        código o QR con el distribuidor.
      </p>
      <Status loading={stores.loading} error={stores.error} />
      {stores.data !== null && stores.data.length === 0 && (
        <p className="mt-4 text-sm">No tenés una tienda asignada.</p>
      )}
      {stores.data !== null && stores.data.length > 0 && (
        <>
          <Field label="Tienda">
            <select
              className={inputClass}
              value={storeId}
              onChange={(event) => setStoreId(event.target.value)}
            >
              {stores.data.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </Field>
          {storeId !== "" && <StoreLinkPanel storeId={Number(storeId)} />}
        </>
      )}
    </section>
  );
}
