-- ============================================================================
-- 20261015000006_rls_grants.sql — RLS + policies + REVOKE/GRANT (§7 paso 8, §8)
-- ============================================================================
-- ENABLE ROW LEVEL SECURITY en TODAS las tablas desde Sprint 1 (default deny):
-- sin policies, el rol queda bloqueado — las tablas "RPC only" (order_items,
-- stock escritura, etc.) se protegen solo con esto + los REVOKE de §4.
-- Policies SOLO TO authenticated (§8: anon no tiene ninguna).
-- Prohibido FOR ALL en tablas sensibles (§8 reglas): SELECT/INSERT/UPDATE/
-- DELETE siempre separados.
--
-- Contradicciones doc-vs-doc resueltas AQUÍ (detalladas en el reporte):
--  (1) §4 revoca SELECT sobre chat_* pero no existe RPC de lectura de chat y
--      §8 da policies de lectura por dueño ⇒ SE GRANTEA SELECT + policies de
--      §8 (precedente D38 con audit_log: el REVOKE que rompe la feature no se
--      copia). Quitar chat del revoke de §4 es un renglón si se endurece.
--  (2) §4 revoca SELECT sobre user_stores (lectura vía my_store_ids()) pero
--      §8 define policy "fila propia, admin": se crea la policy (§8) y se
--      aplica el REVOKE (§4) — la policy queda inactiva a propósito y se
--      activa si algún día se grantea SELECT.
--  (3) price_publications DELETE "admin (soft)": policy exige is_active=false
--      (jamás purga filas activas; el histórico es valioso M2/D27).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY — 25 tablas (11 reutilizadas + 14 FAROX)
-- ---------------------------------------------------------------------------
ALTER TABLE public.roles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_types         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_types        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motives            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_stops        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log          ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Catálogos (§8 fila 1): lectura libre; escritura y borrado solo admin
-- ---------------------------------------------------------------------------
CREATE POLICY catalogs_select ON public.roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.roles
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.roles
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.roles
  FOR DELETE TO authenticated USING (public.my_role() = 'admin');

CREATE POLICY catalogs_select ON public.unit_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.unit_types
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.unit_types
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.unit_types
  FOR DELETE TO authenticated USING (public.my_role() = 'admin');

CREATE POLICY catalogs_select ON public.store_types
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.store_types
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.store_types
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.store_types
  FOR DELETE TO authenticated USING (public.my_role() = 'admin');

-- brands/motives tienen is_active ⇒ el DELETE de la matriz es soft:
-- solo purga filas ya desactivadas.
CREATE POLICY catalogs_select ON public.brands
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.brands
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.brands
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.brands
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

CREATE POLICY catalogs_select ON public.motives
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.motives
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.motives
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.motives
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

-- product_categories no tiene is_active (catálogo jerárquico; las FK RESTRICT
-- de products y el SET NULL de parent_id protegen las filas con historial).
CREATE POLICY catalogs_select ON public.product_categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY catalogs_insert ON public.product_categories
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_update ON public.product_categories
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY catalogs_delete ON public.product_categories
  FOR DELETE TO authenticated USING (public.my_role() = 'admin');

-- ---------------------------------------------------------------------------
-- distributors (§8 fila 4): solo admin y operador lo ven; escritura admin
-- ---------------------------------------------------------------------------
CREATE POLICY distributors_select ON public.distributors
  FOR SELECT TO authenticated
  USING (public.my_role() IN ('admin', 'operador'));
CREATE POLICY distributors_insert ON public.distributors
  FOR INSERT TO authenticated WITH CHECK (public.my_role() = 'admin');
CREATE POLICY distributors_update ON public.distributors
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
CREATE POLICY distributors_delete ON public.distributors
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

-- ---------------------------------------------------------------------------
-- products (§8 fila 2): catálogo de uso general
-- INSERT: admin · operador con has_scope() (D37 se suma en globales).
-- UPDATE: admin · SOLO el creador (D36), con has_scope(); el WITH CHECK
--   impide transferir la propiedad (created_by debe seguir siendo el suyo).
-- DELETE: admin sobre filas ya desactivadas (soft → purge).
-- ---------------------------------------------------------------------------
CREATE POLICY products_select ON public.products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.my_role() = 'admin'
              OR (public.my_role() = 'operador' AND public.has_scope()));
CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin'
         OR (created_by = auth.uid() AND public.has_scope()))
  WITH CHECK (public.my_role() = 'admin'
              OR (created_by = auth.uid() AND public.has_scope()));
CREATE POLICY products_delete ON public.products
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

-- ---------------------------------------------------------------------------
-- stores (§8 fila 3): INSERT solo via create_store() (REVOKE abajo, D35);
-- UPDATE admin · dueño (con has_scope() por D37); DELETE admin soft.
-- ---------------------------------------------------------------------------
CREATE POLICY stores_select ON public.stores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY stores_update ON public.stores
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin'
         OR (created_by = auth.uid() AND public.has_scope()))
  WITH CHECK (public.my_role() = 'admin'
              OR (created_by = auth.uid() AND public.has_scope()));
CREATE POLICY stores_delete ON public.stores
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

-- ---------------------------------------------------------------------------
-- price_publications (§8 fila 5): precio PRIVADO por tienda (D41).
-- SELECT: admin todas · operador SOLO de sus tiendas · distribuidor NINGUNA.
-- INSERT/UPDATE: solo set_price() (REVOKE abajo, D27).
-- DELETE: admin sobre filas inactivas — el histórico vive en filas pasadas.
-- ---------------------------------------------------------------------------
CREATE POLICY price_publications_select ON public.price_publications
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids())));
CREATE POLICY price_publications_delete ON public.price_publications
  FOR DELETE TO authenticated
  USING (public.my_role() = 'admin' AND is_active = false);

-- ---------------------------------------------------------------------------
-- users (§8 fila 6): SELECT fila propia o admin; UPDATE = policy admin (rol/
-- premium/actividad) + policy FILA PROPIA con GRANT por columna de perfil
-- (D45, cierra la excepción D37 "perfil propio"); INSERT via trigger; DELETE
-- nunca (baja = is_active).
-- D45: grants ≠ RLS — la policy decide QUÉ filas, el GRANT QUÉ columnas:
-- full_name/phone_number/contact_preference se editan directo; los
-- privilegiados (id, role_id, email, distributor_id, premium, is_active)
-- solo via RPC/trigger/SQL editor (ver GRANT/REVOKE abajo) — D47 añade
-- set_user_premium()/set_user_active() como ruta RPC para premium/is_active.
-- ---------------------------------------------------------------------------
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.my_role() = 'admin');
CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (public.my_role() = 'admin') WITH CHECK (public.my_role() = 'admin');
-- Excepción D37 "perfil propio" (D45): el usuario muta SOLO su fila; las
-- columnas que puede tocar las limita el GRANT por columna de abajo.
CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- orders (§8 fila 7): SELECT con scope; todo lo demás solo RPC.
-- ---------------------------------------------------------------------------
CREATE POLICY orders_select ON public.orders
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

-- order_items (§8 fila 8): SIN policies — SELECT revocado (D40, unit_price
-- solo premium vía get_order_items); ENABLE RLS = deny-all total.

-- ---------------------------------------------------------------------------
-- stock (§8 fila 9): SELECT admin · operador (sus tiendas) · distribuidor
-- (tiendas de sus pedidos O de su ruta). Escritura solo RPC.
-- ---------------------------------------------------------------------------
CREATE POLICY stock_select ON public.stock
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor' AND (
              EXISTS (SELECT 1 FROM public.orders o
                      WHERE o.distributor_id = public.my_distributor_id()
                        AND o.store_id = stock.store_id)
              OR EXISTS (SELECT 1 FROM public.route_stops rs
                          JOIN public.routes r ON r.id = rs.route_id
                          WHERE r.distributor_id = public.my_distributor_id()
                            AND rs.store_id = stock.store_id))));

-- ---------------------------------------------------------------------------
-- movements (§8 fila 10): append-only. SELECT admin · operador (sus tiendas)
-- · distribuidor SOLO lo suyo (distributor_id = mine — los movimientos
-- manuales sueltos le son invisibles).
-- ---------------------------------------------------------------------------
CREATE POLICY movements_select ON public.movements
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

-- ---------------------------------------------------------------------------
-- routes / route_stops (§8 fila 11): SELECT admin · operador · distribuidor
-- (solo sus rutas). Escritura solo RPC (save_route/mark_stop/update_route_status).
-- ---------------------------------------------------------------------------
CREATE POLICY routes_select ON public.routes
  FOR SELECT TO authenticated
  USING (public.my_role() IN ('admin', 'operador')
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

CREATE POLICY route_stops_select ON public.route_stops
  FOR SELECT TO authenticated
  USING (public.my_role() IN ('admin', 'operador')
         OR (public.my_role() = 'distribuidor' AND EXISTS (
              SELECT 1 FROM public.routes r
              WHERE r.id = route_stops.route_id
                AND r.distributor_id = public.my_distributor_id())));

-- ---------------------------------------------------------------------------
-- credits / credit_payments (§8 fila 12): SELECT admin · operador (cobros).
-- Sin filtro de tienda en la matriz (a diferencia de orders/stock/movements):
-- decisión literal del doc; register_payment() tampoco scopea. Escritura RPC.
-- ---------------------------------------------------------------------------
CREATE POLICY credits_select ON public.credits
  FOR SELECT TO authenticated
  USING (public.my_role() IN ('admin', 'operador'));
CREATE POLICY credit_payments_select ON public.credit_payments
  FOR SELECT TO authenticated
  USING (public.my_role() IN ('admin', 'operador'));

-- ---------------------------------------------------------------------------
-- alerts (§8 fila 13): SELECT admin (todas) · operador (sus tiendas) ·
-- distribuidor SOLO distributor_id = mine (A4: stock_low/expiry_soon tienen
-- distributor_id NULL y no le corresponden). Escritura: jobs/trigger;
-- UPDATE vía mark_alert_read() (SECURITY DEFINER con chequeo interno, A2).
-- ---------------------------------------------------------------------------
CREATE POLICY alerts_select ON public.alerts
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin'
         OR (public.my_role() = 'operador'
             AND store_id = ANY (public.my_store_ids()))
         OR (public.my_role() = 'distribuidor'
             AND distributor_id = public.my_distributor_id()));

-- ---------------------------------------------------------------------------
-- user_stores (§8 fila 14): policy "fila propia, admin" creada según §8, pero
-- §4 revoca SELECT (lectura canónica = my_store_ids()) ⇒ inactiva a propósito.
-- Escritura exclusiva de assign_user_stores() (A1: auto-escalada de alcance).
-- ---------------------------------------------------------------------------
CREATE POLICY user_stores_select ON public.user_stores
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.my_role() = 'admin');

-- ---------------------------------------------------------------------------
-- chat (§8 fila 15): lectura por DUEÑO (§8) en vez del REVOKE de §4 —
-- no existe get_chat()/get_messages() que lo sirva; sin SELECT la feature
-- chat queda muda (contradicción (1) del encabezado, reporte).
-- Escritura: create_chat()/send_message() validan dueño en servidor.
-- ---------------------------------------------------------------------------
CREATE POLICY chat_conversations_select ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY chat_messages_select ON public.chat_messages
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_conversations c
                 WHERE c.id = chat_messages.conversation_id
                   AND c.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- audit_log (§8 fila 16 / D38): policy audit_read solo admin.
-- ---------------------------------------------------------------------------
CREATE POLICY audit_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (public.my_role() = 'admin');

-- ---------------------------------------------------------------------------
-- dashboard_daily (§8 fila 17 / D32+D39 / §3.13): policy dashboard_read —
-- copia literal del doc. is_premium() gate (analítica = premium); operador
-- ve el agregado GLOBAL (A3 MVP); distribuidor solo su distributor_id
-- (fila 0 = movimientos sin pedido no le corresponde).
-- ---------------------------------------------------------------------------
CREATE POLICY dashboard_read ON public.dashboard_daily
  FOR SELECT TO authenticated
  USING (public.is_premium()
         AND (public.my_role() = 'admin'
              OR public.my_role() = 'operador'
              OR distributor_id = public.my_distributor_id()));

-- ---------------------------------------------------------------------------
-- REVOKE/GRANT (§4 A1) — ampliado: las mutaciones pasan SOLO por RPC/trigger
-- ---------------------------------------------------------------------------
-- Tablas mutables por RPC/trigger (nunca directo desde el cliente):
REVOKE INSERT, UPDATE, DELETE ON
  public.stock, public.movements, public.order_items, public.orders,
  public.credits, public.credit_payments, public.price_publications,
  public.alerts, public.routes, public.route_stops, public.user_stores,
  public.dashboard_daily, public.audit_log,
  public.chat_conversations, public.chat_messages
FROM authenticated;

-- Alta de tiendas solo por create_store() (D35); UPDATE/DELETE vía policies.
REVOKE INSERT ON public.stores FROM authenticated;

-- D45: UPDATE de users = SOLO columnas de perfil. El default de Supabase
-- grantea UPDATE de tabla completa a authenticated y anon; con la policy
-- propia, un usuario podría mutar role_id/premium/is_active de SU fila.
-- Los privilegiados se mutan SOLO vía RPC/trigger/SQL editor (D47: premium/
-- is_active vía set_user_premium/set_user_active) — el grant por
-- columna aplica también al admin (todos comparten el rol PG authenticated).
REVOKE UPDATE ON public.users FROM authenticated, anon;
GRANT UPDATE (full_name, phone_number, contact_preference) ON public.users TO authenticated;

-- Lecturas selectivas: user_stores e order_items se leen solo por RPC
-- (my_store_ids, get_order_items con D40). chat_* NO se revoca — ver (1).
REVOKE SELECT ON public.user_stores, public.order_items FROM authenticated;

-- D38/D32: estas dos NO se revocan; se GRANTEAN SELECT con su policy
-- (audit_log: admin la lee; dashboard_daily: realtime exige SELECT+RLS, D32).
GRANT SELECT ON public.audit_log TO authenticated;
GRANT SELECT ON public.dashboard_daily TO authenticated;
-- (1) chat legible por dueño — §8 manda sobre el revoke incompleto de §4.
GRANT SELECT ON public.chat_conversations, public.chat_messages TO authenticated;

-- ---------------------------------------------------------------------------
-- EXECUTE de funciones (§4): authenticated puede llamar las RPC; anon y
-- PUBLIC nunca (el chatbot/n8n siempre viaja con el JWT del usuario).
--
-- REVOKE ... FROM PUBLIC es LA pieza crítica (B3 del review): todo grant de
-- funciones en PG "cae hacia abajo" a PUBLIC, así que sin revocarlo los
-- REVOKE por rol de abajo (internos, jobs) eran INEFECTIVOS y anon podía
-- invocar cualquier RPC sin sesión — con guards NULL-inseguros eso daba
-- escalada a admin (update_user_role sin header Authorization).
--
-- handle_new_user()/sync_email() NO se afectan: son trigger-functions y PG
-- no chequea EXECUTE al disparar el trigger (el chequeo es al CREATE
-- TRIGGER); además su owner (postgres) conserva su EXECUTE propio, igual
-- que pg_cron (los jobs corren como postgres = owner). Los scans job_scan_*
-- y los helpers internos quedan solo para owner/definer.
-- ---------------------------------------------------------------------------
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Helpers internos 4.2 (NO para clientes): los RPC los invocan en contexto
-- SECURITY DEFINER (como owner); un cliente directo saltaría las validaciones
-- de rol/alcance de las RPC que los llaman.
REVOKE EXECUTE ON FUNCTION
  public.internal_alert_open(public.alert_type, bigint, bigint, bigint, bigint, text, jsonb),
  public.internal_alert_resolve(public.alert_type, bigint, bigint, bigint),
  public.internal_eval_stock_alert(bigint, bigint),
  public.internal_dashboard_upsert(bigint, integer, integer, numeric, numeric),
  public.internal_stock_entry(public.movement_type, bigint, bigint, numeric, bigint, bigint, bigint, numeric, date, uuid, bigint)
FROM authenticated;

-- D46 (hardening más allá del doc-literal): job_scan_* es uso exclusivo de
-- pg_cron — los jobs corren como postgres (owner), que conserva EXECUTE.
-- Sin este REVOKE cualquier cliente autenticado disparaba los scans a
-- demanda (son idempotentes, pero no son API pública).
REVOKE EXECUTE ON FUNCTION
  public.job_scan_expiry_soon(),
  public.job_scan_order_late(),
  public.job_scan_credit_overdue()
FROM authenticated;

-- Fin paso 6/8. Realtime/cron: 0007. Verificación: 0008.
