import { useAuth } from "../../../app/providers/AuthProvider";
import { SessionLoading } from "../../../app/guards/SessionLoading";
import { AdminProductsPage } from "./AdminProductsPage";
import { MyCatalogPage } from "./MyCatalogPage";

// Punto de entrada de /products. El admin es el ÚNICO con vista general (S1);
// el resto ve el catálogo de SUS entidades: las tiendas del usuario y/o su
// distribuidora, no un catálogo derivado del nombre del rol (S2/S3).
export function ProductsPage() {
  const { role, status } = useAuth();

  // Mientras el rol se resuelve no se monta ningún catálogo: montar el de
  // entidades y desmontarlo al llegar "admin" dispararía queries inútiles.
  if (status === "loading") return <SessionLoading />;
  if (role === "admin") return <AdminProductsPage />;
  return <MyCatalogPage />;
}
