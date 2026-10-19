# FAROX

## Setup y CI

```bash
npm install    # genera package-lock.json -> commitealo
npm run dev    # dev server (vite)
npm run ci     # lint + typecheck + test + check-scope
npm run build  # build de producción (vite build)
```

El lockfile es obligatorio para CI: el workflow corre `npm ci`, que **falla si `package-lock.json` no existe**.

CI (`.github/workflows/ci.yml`, push a `main` + PRs) gatea: `npm ci` → `npm run build` → lint → typecheck → test → check-scope → `npm audit --audit-level=high`.
