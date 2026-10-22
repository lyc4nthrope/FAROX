// Superficie pública de la feature catalogs (sdd/admin-console T-C4/T-C5).
// El router consume las features por barrel (convención
// distributors/index.ts:1-5) — solo se exportan PÁGINAS.
export { CatalogsPage } from "./routes/CatalogsPage";
export { CatalogCrudPage } from "./routes/CatalogCrudPage";
