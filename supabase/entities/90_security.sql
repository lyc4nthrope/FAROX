-- Entity: SECURITY (lockdown global de grants) | Source: 20261016000011_seguridad.sql:L446-554 (§D-5, VERBATIM) | Order: MUST RUN AFTER TODAS las funciones (00-30 y 60) — el sweep y la whitelist referencian firmas que deben existir; es el penúltimo paso antes de 95_verify
-- ════════════════════════════════════════════════════════════════════════════
-- Lockdown deny-by-default de 0011 §D-5 — SOLO la parte GLOBAL (schema-wide):
-- default privileges futuras, sweep dinámico sobre funciones, whitelist
-- explícita de 31 firmas, re-grants PostGIS, revokes de tablas/sequences y
-- audit_log append-only. NO incluye assert_admin() ni las redefiniciones de
-- RPC con guard nuevo: esas ya viven en 00_foundation.sql (§3.6) y en los
-- archivos de entidad/30_negocio según corresponda (grep-verificado).
-- En 0011 este bloque corre en UNA transacción: sin ventana expuesta entre
-- el REVOKE y los GRANT. El SQL editor de Supabase envuelve el paste en una
-- transacción implícita multi-statement ⇒ misma garantía al pegarlo acá.
-- ════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- D-5 / R14-R15 — Lockdown de grants (deny-by-default)
-- Orden exacto del design; MISMA transacción ⇒ sin ventana expuesta.
-- 1) Default privileges futuras · 2) sweep inmediato · 3) whitelist
-- · 4) PostGIS · 5) tablas · 6) audit_log append-only.
-- ---------------------------------------------------------------------------

-- 1) Default privileges FUTURAS. PUBLIC sin IN SCHEMA (bug PG #8685: la
--    combinación IN SCHEMA + FROM PUBLIC es silenciosamente no-op); roles
--    concretos SÍ con IN SCHEMA. Efecto: toda función nueva creada por
--    postgres nace SIN EXECUTE para clientes — deny-by-default; cada
--    migración futura debe traer su GRANT explícito (convención).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- 2) Sweep inmediato: mata el grant PUBLIC de EXECUTE (CRIT-1: cualquier
--    cliente podía invocar internal_* y las RPC saltándose el check de rol
--    del caller) y deja a anon sin UNA sola función ejecutable en public.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

-- 3) Whitelist explícita (26 RPC + 5 helpers = 31) para authenticated y
--    service_role. Los 5 helpers DEBEN quedar ejecutables o RLS revienta
--    (las policies los invocan como el rol consultante): my_role,
--    is_premium, my_store_ids, my_distributor_id, has_scope.
--    service_role entra en la whitelist por integración n8n/servidor
--    (bypassrls-equivalente: no sumaba seguridad negárselo — D-5).
--    internal_* (5), job_scan_* (3), assert_admin y las 8 trigger
--    functions NO reciben grant (deny-list): los RPC/trigger/jobs los
--    invocan como owner postgres.
--    Firmas = pg_get_function_identity_arguments (typmods incluidos:
--    numeric(12,3)/char(3)/geography(Point,4326) son parte de la identidad).
GRANT EXECUTE ON FUNCTION
  public.my_role(),
  public.is_premium(),
  public.my_store_ids(),
  public.my_distributor_id(),
  public.has_scope(),
  public.update_user_role(uuid, text, bigint),
  public.set_user_premium(uuid, boolean),
  public.set_user_active(uuid, boolean),
  public.assign_user_stores(uuid, bigint[]),
  public.create_store(text, integer, text, text, text, public.geography(Point,4326), text, char(2)),
  public.assign_product_to_store(bigint, bigint, numeric(12,3)),
  public.set_price(bigint, bigint, numeric(12,2), char(3)),
  public.register_entry(bigint, bigint, numeric(12,3), bigint, bigint, date),
  public.register_exit(bigint, bigint, numeric(12,3), bigint, bigint),
  public.register_reverse(bigint, text),
  public.create_order(bigint, bigint, jsonb, timestamptz, text),
  public.update_order_status(bigint, public.order_status, text),
  public.confirm_delivery(bigint, jsonb),
  public.get_order_items(bigint),
  public.save_route(bigint, date, jsonb),
  public.mark_stop(bigint, public.stop_status, timestamptz),
  public.update_route_status(bigint, public.route_status),
  public.create_credit(bigint, date),
  public.cancel_credit(bigint, text),
  public.register_payment(bigint, numeric(14,2), public.payment_method),
  public.register_payment_reverse(bigint, text),
  public.mark_alert_read(bigint),
  public.get_stock(bigint, integer),
  public.get_dashboard(date, date),
  public.create_chat(text),
  public.send_message(bigint, text)
TO authenticated, service_role;

-- 4) PostGIS (open question D-5 / task 0.3): stores_geo es
--    WITH (security_invoker = true) ⇒ el CLIENTE ejecuta
--    public.st_x(s.location::public.geometry) / st_y / el cast
--    geography→geometry COMO CLIENTE — el sweep de (2) les revocó EXECUTE.
--    PRE-CHECK (informativo, sólo lectura de catálogo): muestra las firmas
--    EXACTAS de pg_proc ANTES del GRANT. Si geometry(geography) no aparece
--    con esa firma en el resultado, ajustar el GRANT de abajo al catálogo
--    real antes de commit del apply (verificado por 0012 H1/H4).
SELECT p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname IN ('st_x', 'st_y')
       OR (p.proname = 'geometry'
           AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'geography'))
ORDER BY 1, 2;

GRANT EXECUTE ON FUNCTION
  public.st_x(public.geometry),
  public.st_y(public.geometry),
  public.geometry(public.geography)
TO authenticated;

-- 5) Tablas: anon pierde TODO acceso a las tablas/sequences de public (el
--    default de Supabase les grantea ALL; R17.1: anon no lee ni escribe
--    nada — toda vía es RPC con JWT). El REVOKE explícito de SELECT sobre
--    user_stores/order_items (defensa en profundidad, ya revocado a
--    authenticated en 0006 L373) documenta la intención aunque el sweep
--    cubra tablas futuras. Default privileges: tablas/sequences futuras
--    tampoco nacen accesibles para anon.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE SELECT ON public.user_stores, public.order_items FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 6) R17.2 — audit_log append-only TAMBIÉN para service_role: pierde
--    UPDATE/DELETE (SELECT ya lo tenía; INSERT lo conserva para eventos de
--    integración — el trigger audit_diff escribe como owner).
REVOKE UPDATE, DELETE ON public.audit_log FROM service_role;

-- Fin 90_security. Siguiente: 95_verify.sql (0012 — verificación H1-H4,
-- no modifica nada; cualquier FAIL investigar ANTES de dar por bueno el hardening).
