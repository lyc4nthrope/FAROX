-- ============================================================================
-- Fixtures compartidas de las pruebas SQL (supabase/tests).
-- Se incluyen con \ir desde cada prueba, DENTRO de su transacción: todo se
-- descarta con el ROLLBACK final. IDs fijos (rango 99xxxx) para leer las
-- pruebas sin variables.
--
--   Usuarios (uuid)                           Rol           Alcance
--   ...0001  admin                            admin         —
--   ...0002  operador                         operador      tienda 990001
--   ...0003  distribuidor del pedido          distribuidor  distribuidor 990001
--   ...0004  otro distribuidor                distribuidor  distribuidor 990002
--   ...0005  operador de otra tienda          operador      tienda 990002
-- ============================================================================

INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password,
   raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
SELECT '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
       x.email, 'test-dummy-hash',
       '{"provider":"email","providers":["email"]}', '{}', now(), now(), now()
FROM (VALUES
  ('00000000-0000-0000-0000-000000990001'::uuid, 't_admin@farox.test'),
  ('00000000-0000-0000-0000-000000990002'::uuid, 't_op@farox.test'),
  ('00000000-0000-0000-0000-000000990003'::uuid, 't_dist@farox.test'),
  ('00000000-0000-0000-0000-000000990004'::uuid, 't_dist2@farox.test'),
  ('00000000-0000-0000-0000-000000990005'::uuid, 't_op2@farox.test')
) AS x(id, email);

INSERT INTO public.distributors (id, name, nit, is_active) OVERRIDING SYSTEM VALUE
VALUES (990001, 'T Distribuidor', 'T-NIT-1', true),
       (990002, 'T Otro distribuidor', 'T-NIT-2', true);

UPDATE public.users SET role_id = (SELECT id FROM public.roles WHERE name = 'admin')
WHERE id = '00000000-0000-0000-0000-000000990001';
UPDATE public.users
SET role_id = (SELECT id FROM public.roles WHERE name = 'distribuidor'), distributor_id = 990001
WHERE id = '00000000-0000-0000-0000-000000990003';
UPDATE public.users
SET role_id = (SELECT id FROM public.roles WHERE name = 'distribuidor'), distributor_id = 990002
WHERE id = '00000000-0000-0000-0000-000000990004';

INSERT INTO public.stores (id, store_type_id, name, address, city, country, location, created_by)
OVERRIDING SYSTEM VALUE
SELECT x.id, st.id, x.name, 'Calle 1', 'Armenia', 'CO',
       ST_SetSRID(ST_MakePoint(-75.68, 4.53), 4326)::public.geography,
       '00000000-0000-0000-0000-000000990001'
FROM (VALUES (990001, 'T Tienda'), (990002, 'T Otra tienda')) AS x(id, name),
     LATERAL (SELECT id FROM public.store_types ORDER BY id LIMIT 1) st;

INSERT INTO public.user_stores (user_id, store_id)
VALUES ('00000000-0000-0000-0000-000000990002', 990001),
       ('00000000-0000-0000-0000-000000990005', 990002);

INSERT INTO public.store_distributors (store_id, distributor_id, created_by)
VALUES (990001, 990001, '00000000-0000-0000-0000-000000990002');

INSERT INTO public.products (id, name, category_id, brand_id, unit_type_id, created_by, base_quantity)
OVERRIDING SYSTEM VALUE
SELECT x.id, x.name, c.id, b.id, u.id, '00000000-0000-0000-0000-000000990001', 1
FROM (VALUES (990001, 'T Arroz'), (990002, 'T Aceite')) AS x(id, name),
     LATERAL (SELECT id FROM public.product_categories ORDER BY id LIMIT 1) c,
     LATERAL (SELECT id FROM public.brands ORDER BY id LIMIT 1) b,
     LATERAL (SELECT id FROM public.unit_types ORDER BY id LIMIT 1) u;

-- Ejecuta lo que sigue como el usuario dado (rol authenticated + JWT simulado).
CREATE FUNCTION pg_temp.claims(p_user uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT json_build_object('sub', p_user, 'role', 'authenticated')::text
$$;
