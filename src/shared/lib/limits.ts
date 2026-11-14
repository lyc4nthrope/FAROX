// Espejo cliente de los CHECK de longitud de las migraciones 0040/0041.
// Fuente de verdad = la base de datos; estos valores existen para fallar
// temprano en el formulario (maxLength + Zod) y no depender del error crudo
// de Postgres. Si cambia un límite en SQL, cambia acá — y viceversa.
export const LIMITS = {
  userName: 120,
  userPhone: 32,
  catalogName: 80,
  catalogDescription: 255,
  productName: 160,
  productDescription: 2000,
  storeName: 160,
  storeAddress: 255,
  storeCity: 80,
  storePhone: 32,
  storeWebsite: 500,
  distributorName: 160,
  distributorNit: 32,
  distributorContactName: 120,
  distributorPhone: 32,
  distributorEmail: 255,
  orderNotes: 2000,
  cancelReason: 500,
  chatMessage: 800,
} as const;
