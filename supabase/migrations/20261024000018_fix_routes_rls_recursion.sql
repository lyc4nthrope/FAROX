-- ============================================================================
-- FAROX — 0018: corrige la recursión infinita entre las policies de
-- routes, route_stops y stock.
--
-- PROBLEMA (encontrado al ejecutar los flujos de usuario contra un stack local
-- con 0001–0015 aplicadas, 2026-10-24):
--   routes_select (0009)      → EXISTS sobre route_stops
--   route_stops_select (0009) → EXISTS sobre routes
--   stock_select (0006)       → JOIN route_stops + routes
-- Postgres expande las policies de cada tabla referenciada y detecta el ciclo:
--   ERROR 42P17: infinite recursion detected in policy for relation "route_stops"
-- Efecto: cualquier SELECT de un no-admin sobre stock, routes o route_stops
-- falla (inventario, "Mi ruta", chatbot get_stock vía RLS).
--
-- SOLUCIÓN: tres helpers SECURITY DEFINER (leen sin RLS, como los helpers de
-- alcance de 0009) que devuelven los ids necesarios; las policies los usan en
-- lugar de subconsultas cruzadas. La SEMÁNTICA de visibilidad no cambia:
--   · operador ve las rutas que tienen alguna parada en sus tiendas;
--   · distribuidor ve sus rutas, sus paradas y el stock de las tiendas de sus
--     pedidos o de sus rutas.
--
-- Reglas: SET search_path; GRANT EXECUTE explícito solo a authenticated y
-- service_role (deny-by-default, D48); los helpers devuelven vacío si el
-- usuario está inactivo (porque my_distributor_id()/my_store_ids() ya lo hacen).
-- Nota whitelist: +3 firmas. Volver a correr 0012 después de esta migración
-- da FAIL esperado en el conteo exacto de la whitelist (ver doc de BD §9).
-- ============================================================================

-- Rutas del distribuidor del JWT.
CREATE OR REPLACE FUNCTION public.my_route_ids()
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(r.id), '{}')
  FROM public.routes r
  WHERE r.distributor_id = public.my_distributor_id();
$$;

-- Rutas que tienen al menos una parada en las tiendas del operador.
CREATE OR REPLACE FUNCTION public.routes_with_my_stores()
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(DISTINCT rs.route_id), '{}')
  FROM public.route_stops rs
  WHERE rs.store_id = ANY (public.my_store_ids());
$$;

-- Tiendas que aparecen en las rutas del distribuidor del JWT.
CREATE OR REPLACE FUNCTION public.stores_on_my_routes()
RETURNS bigint[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(DISTINCT rs.store_id), '{}')
  FROM public.route_stops rs
  JOIN public.routes r ON r.id = rs.route_id
  WHERE r.distributor_id = public.my_distributor_id();
$$;

REVOKE EXECUTE ON FUNCTION public.my_route_ids(), public.routes_with_my_stores(),
  public.stores_on_my_routes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_route_ids(), public.routes_with_my_stores(),
  public.stores_on_my_routes() TO authenticated, service_role;

DROP POLICY IF EXISTS routes_select ON public.routes;
CREATE POLICY routes_select ON public.routes
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador' AND id = ANY (public.routes_with_my_stores()))
         OR (public.my_role() = 'distribuidor' AND distributor_id = public.my_distributor_id()));

DROP POLICY IF EXISTS route_stops_select ON public.route_stops;
CREATE POLICY route_stops_select ON public.route_stops
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador' AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor' AND route_id = ANY (public.my_route_ids())));

DROP POLICY IF EXISTS stock_select ON public.stock;
CREATE POLICY stock_select ON public.stock
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador' AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor' AND (
              EXISTS (SELECT 1 FROM public.orders o
                      WHERE o.distributor_id = public.my_distributor_id()
                        AND o.store_id = stock.store_id)
              OR store_id = ANY (public.stores_on_my_routes()))));

-- INVERSE (inerte; descomentar a mano en una transacción para revertir):
-- DROP POLICY IF EXISTS stock_select ON public.stock;        -- y recrear la de 0006
-- DROP POLICY IF EXISTS route_stops_select ON public.route_stops; -- y recrear la de 0009
-- DROP POLICY IF EXISTS routes_select ON public.routes;      -- y recrear la de 0009
-- DROP FUNCTION IF EXISTS public.stores_on_my_routes();
-- DROP FUNCTION IF EXISTS public.routes_with_my_stores();
-- DROP FUNCTION IF EXISTS public.my_route_ids();
