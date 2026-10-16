-- ============================================================================
-- 20261015000005_seeds.sql — Seeds en orden (§7 paso 6, D19)
-- ============================================================================
-- Semilla MÍNIMA de catálogos. Solo catálogos SIN created_by: los seeds con
-- created_by NOT NULL (tiendas, órdenes, precios) corren DESPUÉS del paso 7
-- manual (signup del primer admin → update_user_role) — ver supabase/README.md.
-- Usuarios NO se seedean: se crean vía signup (handle_new_user, 0004).
--
-- Idempotentes: ON CONFLICT DO NOTHING sobre el UNIQUE de name (salvo
-- unit_types, con dos UNIQUE ⇒ sin target para cubrir ambos).
-- Orden (§7.6): a) roles → b) unit_types, store_types → c) product_categories
--   (padres ANTES que hijos por parent_id) → d) brands → e) motives.
-- ============================================================================

-- a) roles --------------------------------------------------------------------
-- handle_new_user() exige 'operador'; update_user_role()/my_role()/'is_premium()
-- distinguen 'admin'; sanitize_distributor_scope() distingue 'distribuidor'.
INSERT INTO public.roles (name, description) VALUES
  ('admin',       'Acceso total: catálogos, usuarios, override de edición'),
  ('operador',    'Ejecución con alcance por tienda (user_stores)'),
  ('distribuidor','Distribuidor con alcance por distributor_id (M11)')
ON CONFLICT (name) DO NOTHING;

-- b) unit_types + store_types -------------------------------------------------
-- unit_types: dos UNIQUE (name y abbreviation) ⇒ ON CONFLICT sin target.
-- §2.2/§7: la unicidad de abbreviation se valida aquí mismo — el constraint
-- uq_unit_types_abbreviation (0002) revienta si estas 3 abreviaturas chocaran.
INSERT INTO public.unit_types (name, abbreviation, category) VALUES
  ('Unidad',   'und', 'unidad'),
  ('Kilogramo', 'kg',  'peso'),
  ('Litro',    'lt',  'volumen')
ON CONFLICT DO NOTHING;

-- store_types: mínimo 1 fila — stores.store_type_id es NOT NULL y create_store()
-- valida la existencia (0004). El admin amplía el catálogo desde la app (§8).
INSERT INTO public.store_types (name) VALUES
  ('Tienda')
ON CONFLICT (name) DO NOTHING;

-- c) product_categories — padres ANTES que hijos (parent_id, §2.5/D5) ----------
-- Jerarquía del .md (Ej: Bebidas → Refrescos). parent_id es nullable ⇒ con una
-- raíz y un hijo se prueba la jerarquía; el catálogo plano sigue siendo válido.
INSERT INTO public.product_categories (name, description, parent_id) VALUES
  ('Bebidas', 'Bebidas en general', NULL)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.product_categories (name, description, parent_id) VALUES
  ('Refrescos', 'Refrescos y gaseosas',
   (SELECT id FROM public.product_categories WHERE name = 'Bebidas'))
ON CONFLICT (name) DO NOTHING;

-- d) brands -------------------------------------------------------------------
-- products.brand_id NOT NULL (D14): mínimo 1 fila para poder crear productos.
INSERT INTO public.brands (name) VALUES
  ('Genérica')
ON CONFLICT (name) DO NOTHING;

-- e) motives — obligatorio (D19/INV-04/DIST-04) -------------------------------
-- Nombres en minúscula: confirm_delivery() busca name = 'reabastecimiento'
-- exacto (0004). suggested_type: entry/exit sugerido; NULL = aplica a ambos.
INSERT INTO public.motives (name, suggested_type) VALUES
  ('venta',            'exit'),
  ('reabastecimiento', 'entry'),
  ('devolución',       'entry'),
  ('merma',            'exit'),
  ('ajuste',           NULL)
ON CONFLICT (name) DO NOTHING;
