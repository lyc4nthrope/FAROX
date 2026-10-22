// Superficie pública de la feature users (sdd/admin-console T-B4/T-B9).
// El router consume las features por barrel (convención
// distributors/index.ts:1-5) — solo se exportan PÁGINAS.
export { UsersPage } from "./routes/UsersPage";
export { UserDetailPage } from "./routes/UserDetailPage";
