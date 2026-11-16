#!/usr/bin/env bash
# Corre las pruebas SQL de supabase/tests contra el Postgres LOCAL de Supabase.
# Cada archivo abre su transacción y termina en ROLLBACK: no deja datos.
# Uso: scripts/db-test.sh [archivo.sql ...]   (sin argumentos: todos)
# DB_CONTAINER: contenedor de Postgres (por defecto supabase_db_<carpeta del repo>).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
container="${DB_CONTAINER:-supabase_db_$(basename "$root")}"

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
