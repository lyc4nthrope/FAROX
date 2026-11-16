#!/usr/bin/env bash
# Corre las pruebas SQL de supabase/tests contra el Postgres LOCAL de Supabase.
# Cada archivo abre su transacción y termina en ROLLBACK: no deja datos.
# Uso: scripts/db-test.sh [archivo.sql ...]   (sin argumentos: todos)
# DB_CONTAINER: contenedor de Postgres (por defecto supabase_db_<project_id de config.toml>).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
project_id="$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' "$root/supabase/config.toml")"
container="${DB_CONTAINER:-supabase_db_${project_id}}"

if ! docker inspect "$container" >/dev/null 2>&1; then
  echo "No existe el contenedor $container: correr 'npx supabase db start' primero." >&2
  exit 2
fi

if [ "$#" -gt 0 ]; then files=("$@"); else files=("$root"/supabase/tests/[0-9]*.sql); fi

# Copia la carpeta para que \ir resuelva _fixtures.sql dentro del contenedor.
docker exec "$container" rm -rf /tmp/farox-tests
docker cp "$root/supabase/tests" "$container:/tmp/farox-tests"

failed=0
for f in "${files[@]}"; do
  name="$(basename "$f")"
  echo "── $name"
  if docker exec "$container" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
       -f "/tmp/farox-tests/$name" 2>&1 | sed -E 's/^psql:[^ ]+ //'; then
    :
  else
    failed=1
  fi
done

[ "$failed" -eq 0 ] && echo "OK — pruebas SQL en verde" || { echo "FALLÓ al menos una prueba SQL" >&2; exit 1; }
