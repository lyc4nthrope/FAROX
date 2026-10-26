-- ============================================================================
-- FAROX · Seed de catálogo demo
-- Productos + marcas + categorías + stock (cantidades por tienda)
-- ============================================================================
-- Cómo correrlo
--   Supabase Dashboard → SQL Editor → pegar todo el archivo → Run.
--   No es una migración: no se aplica con `supabase db push` ni en un
--   `db reset` remoto. Es opt-in y manual a propósito (son datos de demo).
--
-- Qué crea
--   · 26 categorías nuevas (11 raíz + 15 subcategorías; reutiliza "Bebidas"
--     y "Refrescos" si ya existen)
--   · 100 marcas (reutiliza "Genérica")
--   · 177 productos en 12 verticales: abarrotes, bebidas, lácteos, carnes,
--     frutas y verduras, panadería/snacks, aseo, cuidado personal,
--     ferretería, papelería, mascotas y desechables
--   · Filas de stock para CADA producto × CADA tienda activa, con cantidades
--     variables, umbrales y fechas de caducidad en perecederos
--   · Alertas `stock_low` materializadas para los pares bajo umbral
--
-- Idempotente
--   Se puede correr varias veces: no duplica categorías, marcas, productos ni
--   filas de stock. No sobrescribe cantidades ya existentes.
--
-- Convención de unidades
--   und = pieza o paquete discreto (base_quantity 1)
--   kg  = venta a granel por peso (base_quantity 1)
--   lt  = líquidos (base_quantity = tamaño de la botella en litros)
--   stock.quantity se expresa en la unidad del producto.
--
-- Requisito
--   products.created_by es NOT NULL → debe existir al menos un usuario en
--   public.users (signup previo). Si no hay, el script aborta con mensaje claro.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Contexto: usuario que firma created_by (admin si existe, si no el primero)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS _seed_ctx;
CREATE TEMP TABLE _seed_ctx ON COMMIT DROP AS
SELECT COALESCE(
         (SELECT u.id
            FROM public.users u
            JOIN public.roles r ON r.id = u.role_id
           WHERE r.name = 'admin' AND u.is_active
           ORDER BY u.created_at
           LIMIT 1),
         (SELECT u.id FROM public.users u ORDER BY u.created_at LIMIT 1)
       ) AS admin_id;

DO $$
BEGIN
  IF (SELECT admin_id FROM _seed_ctx) IS NULL THEN
    RAISE EXCEPTION
      'FAROX seed: public.users está vacío. Crea el primer usuario admin por signup antes de sembrar productos (products.created_by NOT NULL).';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Categorías raíz
-- ----------------------------------------------------------------------------
INSERT INTO public.product_categories (name, description, parent_id) VALUES
  ('Abarrotes',           'Despensa seca: granos, enlatados, condimentos y harinas', NULL),
  ('Lácteos y huevos',    'Leches, derivados lácteos, quesos y huevos',              NULL),
  ('Carnes y embutidos',  'Carnes frescas, pollo y embutidos',                       NULL),
  ('Frutas y verduras',   'Frescos a granel y por unidad',                           NULL),
  ('Panadería y snacks',  'Pan, galletas, pasabocas y chocolates',                   NULL),
  ('Aseo y limpieza',     'Detergentes, desinfectantes y artículos de aseo',         NULL),
  ('Cuidado personal',    'Higiene y aseo corporal',                                 NULL),
  ('Ferretería',          'Herramientas, materiales y suministros',                  NULL),
  ('Papelería',           'Útiles escolares y de oficina',                           NULL),
  ('Mascotas',            'Alimento y accesorios para mascotas',                     NULL),
  ('Hogar y desechables', 'Desechables, papel y artículos de cocina',                NULL)
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Subcategorías (los padres se resuelven por nombre; "Bebidas" ya existe)
-- ----------------------------------------------------------------------------
INSERT INTO public.product_categories (name, description, parent_id)
SELECT v.name, v.descr, p.id
FROM (VALUES
  ('Arroz, pastas y granos',  'Arroz, pastas, legumbres y cereales',       'Abarrotes'),
  ('Enlatados y conservas',   'Conservas, salsas y embutidos enlatados',   'Abarrotes'),
  ('Aceites y condimentos',   'Aceites, sal, azúcar y especias',           'Abarrotes'),
  ('Harinas y repostería',    'Harinas, leudantes y mezclas para hornear', 'Abarrotes'),
  ('Aguas y jugos',           'Aguas, jugos y néctares',                   'Bebidas'),
  ('Café e infusiones',       'Café, aromáticas y chocolate de mesa',      'Bebidas'),
  ('Cervezas y licores',      'Cervezas, aguardientes y licores',          'Bebidas'),
  ('Leches y derivados',      'Leche, yogurt, mantequilla y crema',        'Lácteos y huevos'),
  ('Quesos',                  'Quesos frescos y madurados',                'Lácteos y huevos'),
  ('Frutas',                  'Frutas frescas',                            'Frutas y verduras'),
  ('Verduras y tubérculos',   'Hortalizas, verduras y tubérculos',         'Frutas y verduras'),
  ('Herramientas manuales',   'Herramientas de mano y eléctricas',         'Ferretería'),
  ('Plomería',                'Tubería, conexiones y grifería',            'Ferretería'),
  ('Eléctrico e iluminación', 'Cable, iluminación y accesorios eléctricos','Ferretería'),
  ('Pinturas y adhesivos',    'Pinturas, brochas, pegantes y sellantes',   'Ferretería')
) AS v(name, descr, parent)
JOIN public.product_categories p ON p.name = v.parent
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Marcas
-- ----------------------------------------------------------------------------
INSERT INTO public.brands (name) VALUES
  ('Genérica'),
  ('Diana'), ('Florhuila'), ('Roa'), ('Doria'), ('Comarrico'), ('Búcaro'),
  ('Quaker'), ('Doña Arepa'), ('Van Camps'), ('La Constancia'), ('Zenú'),
  ('Fruco'), ('Noel'), ('Premier'), ('Refisal'), ('Manuelita'), ('Doña Gallina'),
  ('Maggi'), ('Haz de Oros'), ('Fleischmann'), ('Luker'), ('Gelco'), ('Ramo'),
  ('Postobón'), ('Coca-Cola'), ('Colombiana'), ('PepsiCo'), ('Cristal'),
  ('Manantial'), ('Hit'), ('Cifrut'), ('Sello Rojo'), ('Águila Roja'),
  ('Nescafé'), ('Juan Valdez'), ('Águila'), ('Poker'), ('Club Colombia'),
  ('Antioqueño'), ('Ron Medellín'), ('Alpina'), ('Colanta'), ('Alquería'),
  ('Nido'), ('Pietrán'), ('Ranchera'), ('Bimbo'), ('Festival'), ('Margarita'),
  ('Detodito'), ('Jet'), ('Tosh'), ('La Especial'), ('Fab'), ('Ariel'),
  ('Rinso'), ('Suavitel'), ('Fabuloso'), ('Axión'), ('Brilla'), ('Loza Limpia'),
  ('Semper'), ('Glade'), ('Protex'), ('Dove'), ('Colgate'), ('Familia'),
  ('Rexona'), ('Sedal'), ('Nivea'), ('Nosotras'), ('Gillette'), ('Truper'),
  ('Stanley'), ('Pretul'), ('Bosch'), ('Makita'), ('DeWalt'), ('Pavco'),
  ('Gerfor'), ('Grival'), ('3M'), ('Pintuco'), ('Loctite'), ('Sika'),
  ('Abracol'), ('Norma'), ('BIC'), ('Faber-Castell'), ('Pelikan'), ('Scribe'),
  ('Kiut'), ('Purina'), ('Pedigree'), ('Whiskas'), ('Dogourmet'), ('Ringo'),
  ('Darnel'), ('Carvajal')
ON CONFLICT (name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Catálogo temporal (fuente única para productos y stock)
--    seq        → semilla del código de barras EAN-13
--    base_stock → cantidad típica en UNA tienda, en la unidad del producto
--    perish     → lleva fecha de caducidad
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS _seed_catalog;
CREATE TEMP TABLE _seed_catalog ON COMMIT DROP AS
SELECT * FROM (VALUES
  -- ABARROTES · Arroz, pastas y granos -------------------------------------
  (  1,'Arroz Diana 500 g','Arroz blanco tipo I, bolsa x 500 g','Arroz, pastas y granos','Diana','und',1.0,48,false),
  (  2,'Arroz Florhuila 1 kg','Arroz blanco tipo I, bolsa x 1 kg','Arroz, pastas y granos','Florhuila','und',1.0,36,false),
  (  3,'Arroz Roa 3 kg','Arroz blanco tipo I, bulto x 3 kg','Arroz, pastas y granos','Roa','und',1.0,14,false),
  (  4,'Arroz a granel','Arroz blanco suelto, venta por kilo','Arroz, pastas y granos','Genérica','kg',1.0,30,false),
  (  5,'Pasta Doria Espagueti 500 g','Espagueti, bolsa x 500 g','Arroz, pastas y granos','Doria','und',1.0,60,false),
  (  6,'Pasta Comarrico Macarrones 250 g','Macarrones, bolsa x 250 g','Arroz, pastas y granos','Comarrico','und',1.0,42,false),
  (  7,'Lentejas Búcaro 500 g','Lenteja seca, bolsa x 500 g','Arroz, pastas y granos','Búcaro','und',1.0,30,false),
  (  8,'Frijol cargamanto a granel','Frijol cargamanto seco, venta por kilo','Arroz, pastas y granos','Genérica','kg',1.0,28,false),
  (  9,'Maíz pira Diana 500 g','Maíz pira para crispetas, bolsa x 500 g','Arroz, pastas y granos','Diana','und',1.0,22,false),
  ( 10,'Avena en hojuelas Quaker 500 g','Avena tradicional, bolsa x 500 g','Arroz, pastas y granos','Quaker','und',1.0,20,false),
  ( 11,'Harina de maíz Doña Arepa 1 kg','Harina precocida de maíz, bolsa x 1 kg','Arroz, pastas y granos','Doña Arepa','und',1.0,24,false),
  -- ABARROTES · Enlatados y conservas -------------------------------------
  ( 12,'Atún Van Camps en agua 170 g','Atún en agua, lata x 170 g','Enlatados y conservas','Van Camps','und',1.0,36,false),
  ( 13,'Sardinas La Constancia 425 g','Sardinas en tomate, lata x 425 g','Enlatados y conservas','La Constancia','und',1.0,24,false),
  ( 14,'Salchichas Zenú 500 g','Salchicha tipo viena, paquete x 500 g','Enlatados y conservas','Zenú','und',1.0,30,false),
  ( 15,'Maíz tierno en grano Fruco 300 g','Maíz dulce en grano, lata x 300 g','Enlatados y conservas','Fruco','und',1.0,18,false),
  ( 16,'Salsa de tomate Fruco 400 g','Salsa de tomate lista, bolsa x 400 g','Enlatados y conservas','Fruco','und',1.0,26,false),
  ( 17,'Mayonesa Fruco 445 g','Mayonesa clásica, doypack x 445 g','Enlatados y conservas','Fruco','und',1.0,20,false),
  ( 18,'Mermelada de mora Noel 300 g','Mermelada de mora, frasco x 300 g','Enlatados y conservas','Noel','und',1.0,14,false),
  -- ABARROTES · Aceites y condimentos --------------------------------------
  ( 19,'Aceite Girasol Premier 1 L','Aceite de girasol, botella x 1 L','Aceites y condimentos','Premier','lt',1.0,32,false),
  ( 20,'Aceite de oliva extra virgen 500 ml','Aceite de oliva, botella x 500 ml','Aceites y condimentos','Genérica','lt',0.5,12,false),
  ( 21,'Vinagre blanco Fruco 1 L','Vinagre blanco, botella x 1 L','Aceites y condimentos','Fruco','lt',1.0,12,false),
  ( 22,'Sal Refisal 1 kg','Sal refinada yodada, bolsa x 1 kg','Aceites y condimentos','Refisal','und',1.0,30,false),
  ( 23,'Azúcar Manuelita 2 kg','Azúcar blanco, bolsa x 2 kg','Aceites y condimentos','Manuelita','und',1.0,22,false),
  ( 24,'Panela cuadrada 500 g','Panela en bloque x 500 g','Aceites y condimentos','Genérica','und',1.0,26,false),
  ( 25,'Condimento Doña Gallina 400 g','Condimento con azafrán, bolsa x 400 g','Aceites y condimentos','Doña Gallina','und',1.0,32,false),
  ( 26,'Comino molido 50 g','Comino molido, sobre x 50 g','Aceites y condimentos','Genérica','und',1.0,15,false),
  ( 27,'Pimienta negra molida 50 g','Pimienta negra molida, sobre x 50 g','Aceites y condimentos','Genérica','und',1.0,15,false),
  ( 28,'Sopa Maggi Gallina 70 g','Sopa instantánea de gallina','Aceites y condimentos','Maggi','und',1.0,40,false),
  ( 29,'Caldo de costilla Maggi x 4','Caldo concentrado, caja x 4 cubos','Aceites y condimentos','Maggi','und',1.0,30,false),
  -- ABARROTES · Harinas y repostería ---------------------------------------
  ( 30,'Harina de trigo Haz de Oros 1 kg','Harina de trigo todo uso, bolsa x 1 kg','Harinas y repostería','Haz de Oros','und',1.0,18,false),
  ( 31,'Levadura en polvo Fleischmann 50 g','Levadura seca instantánea, sobre x 50 g','Harinas y repostería','Fleischmann','und',1.0,12,false),
  ( 32,'Cacao en polvo Luker 200 g','Cacao en polvo, bolsa x 200 g','Harinas y repostería','Luker','und',1.0,16,false),
  ( 33,'Gelatina Gelco fresa 30 g','Gelatina sabor fresa, sobre x 30 g','Harinas y repostería','Gelco','und',1.0,45,false),
  ( 34,'Mezcla para torta Ramo 500 g','Mezcla para torta de vainilla x 500 g','Harinas y repostería','Ramo','und',1.0,10,false),
  -- BEBIDAS · Refrescos (categoría preexistente) ---------------------------
  ( 35,'Gaseosa Postobón 1.5 L','Gaseosa sabor cola, botella x 1.5 L','Refrescos','Postobón','lt',1.5,90,false),
  ( 36,'Gaseosa Coca-Cola 1.5 L','Gaseosa cola, botella x 1.5 L','Refrescos','Coca-Cola','lt',1.5,84,false),
  ( 37,'Gaseosa Colombiana 1.5 L','Gaseosa sabor colombiana, botella x 1.5 L','Refrescos','Colombiana','lt',1.5,60,false),
  ( 38,'Gaseosa Pepsi 400 ml','Gaseosa cola, botella x 400 ml','Refrescos','PepsiCo','lt',0.4,36,false),
  ( 39,'Gaseosa Manzana Postobón 400 ml','Gaseosa sabor manzana, botella x 400 ml','Refrescos','Postobón','lt',0.4,32,false),
  -- BEBIDAS · Aguas y jugos ------------------------------------------------
  ( 40,'Agua Cristal sin gas 1 L','Agua potable tratada, botella x 1 L','Aguas y jugos','Cristal','lt',1.0,60,false),
  ( 41,'Agua Manantial con gas 600 ml','Agua mineral con gas, botella x 600 ml','Aguas y jugos','Manantial','lt',0.6,36,false),
  ( 42,'Jugo Hit Mora 1 L','Jugo de mora, botella x 1 L','Aguas y jugos','Hit','lt',1.0,40,false),
  ( 43,'Jugo Cifrut Naranja 1 L','Jugo de naranja, botella x 1 L','Aguas y jugos','Cifrut','lt',1.0,30,false),
  ( 44,'Néctar de mango a granel','Néctar de mango para vaso, venta por litro','Aguas y jugos','Genérica','lt',1.0,10,false),
  -- BEBIDAS · Café e infusiones --------------------------------------------
  ( 45,'Café Sello Rojo Molido 500 g','Café tostado y molido, bolsa x 500 g','Café e infusiones','Sello Rojo','und',1.0,26,false),
  ( 46,'Café Águila Roja Molido 500 g','Café tostado y molido, bolsa x 500 g','Café e infusiones','Águila Roja','und',1.0,22,false),
  ( 47,'Café instantáneo Nescafé Clásico 170 g','Café soluble, frasco x 170 g','Café e infusiones','Nescafé','und',1.0,18,false),
  ( 48,'Café en grano Juan Valdez 500 g','Café tostado en grano, bolsa x 500 g','Café e infusiones','Juan Valdez','und',1.0,10,false),
  ( 49,'Aromática manzanilla x 25','Té de manzanilla, caja x 25 bolsas','Café e infusiones','Genérica','und',1.0,24,false),
  ( 50,'Chocolate de mesa Luker 500 g','Chocolate en pastillas x 500 g','Café e infusiones','Luker','und',1.0,20,false),
  -- BEBIDAS · Cervezas y licores -------------------------------------------
  ( 51,'Cerveza Águila 330 ml','Cerveza lager, botella x 330 ml','Cervezas y licores','Águila','und',1.0,72,false),
  ( 52,'Cerveza Poker 330 ml','Cerveza lager, botella x 330 ml','Cervezas y licores','Poker','und',1.0,60,false),
  ( 53,'Cerveza Club Colombia 330 ml','Cerveza premium, botella x 330 ml','Cervezas y licores','Club Colombia','und',1.0,36,false),
  ( 54,'Aguardiente Antioqueño 750 ml','Aguardiente sin azúcar, botella x 750 ml','Cervezas y licores','Antioqueño','lt',0.75,9,false),
  ( 55,'Ron Medellín 750 ml','Ron añejo, botella x 750 ml','Cervezas y licores','Ron Medellín','lt',0.75,5,false),
  -- LÁCTEOS Y HUEVOS · Leches y derivados ----------------------------------
  ( 56,'Leche entera Alpina 1 L','Leche entera UHT, bolsa x 1 L','Leches y derivados','Alpina','lt',1.0,60,true),
  ( 57,'Leche entera Colanta 1 L','Leche entera UHT, bolsa x 1 L','Leches y derivados','Colanta','lt',1.0,54,true),
  ( 58,'Leche deslactosada Alquería 1 L','Leche deslactosada UHT, bolsa x 1 L','Leches y derivados','Alquería','lt',1.0,30,true),
  ( 59,'Leche en polvo Nido 400 g','Leche en polvo fortificada, bolsa x 400 g','Leches y derivados','Nido','und',1.0,16,false),
  ( 60,'Yogurt Alpina Fresa 1 L','Yogurt bebible sabor fresa, botella x 1 L','Leches y derivados','Alpina','lt',1.0,24,true),
  ( 61,'Yogurt griego Alquería 900 g','Yogurt griego natural, vaso x 900 g','Leches y derivados','Alquería','und',1.0,12,true),
  ( 62,'Mantequilla Colanta 250 g','Mantequilla con sal, bloque x 250 g','Leches y derivados','Colanta','und',1.0,18,true),
  ( 63,'Crema de leche Alpina 200 ml','Crema de leche líquida, vaso x 200 ml','Leches y derivados','Alpina','und',1.0,20,true),
  -- LÁCTEOS Y HUEVOS · Quesos -----------------------------------------------
  ( 64,'Queso campesino a granel','Queso fresco campesino, venta por kilo','Quesos','Genérica','kg',1.0,9,true),
  ( 65,'Queso mozzarella Colanta 500 g','Queso mozzarella rallado, bolsa x 500 g','Quesos','Colanta','und',1.0,10,true),
  ( 66,'Queso doble crema Alpina 250 g','Queso doble crema, bloque x 250 g','Quesos','Alpina','und',1.0,12,true),
  -- LÁCTEOS Y HUEVOS · Huevos (bajo la categoría raíz) ----------------------
  ( 67,'Huevo AA plancha x 30','Huevo rojo AA, plancha x 30 unidades','Lácteos y huevos','Genérica','und',1.0,22,true),
  ( 68,'Huevo AA bandeja x 12','Huevo rojo AA, bandeja x 12 unidades','Lácteos y huevos','Genérica','und',1.0,34,true),
  -- CARNES Y EMBUTIDOS ------------------------------------------------------
  ( 69,'Pechuga de pollo a granel','Pechuga de pollo fresca, venta por kilo','Carnes y embutidos','Genérica','kg',1.0,16,true),
  ( 70,'Muslo de pollo a granel','Muslo de pollo fresco, venta por kilo','Carnes y embutidos','Genérica','kg',1.0,12,true),
  ( 71,'Carne de res molida a granel','Carne de res molida, venta por kilo','Carnes y embutidos','Genérica','kg',1.0,10,true),
  ( 72,'Carne de cerdo para asar a granel','Pierna de cerdo fresca, venta por kilo','Carnes y embutidos','Genérica','kg',1.0,8,true),
  ( 73,'Chorizo santarrosano Zenú 500 g','Chorizo de cerdo, paquete x 500 g','Carnes y embutidos','Zenú','und',1.0,14,true),
  ( 74,'Jamón Pietrán 250 g','Jamón de cerdo loncheado x 250 g','Carnes y embutidos','Pietrán','und',1.0,10,true),
  ( 75,'Salchichón Ranchera 500 g','Salchichón tipo cervecero x 500 g','Carnes y embutidos','Ranchera','und',1.0,12,true),
  -- FRUTAS Y VERDURAS · Frutas ---------------------------------------------
  ( 76,'Manzana roja a granel','Manzana roja importada, venta por kilo','Frutas','Genérica','kg',1.0,20,true),
  ( 77,'Banano criollo a granel','Banano criollo maduro, venta por kilo','Frutas','Genérica','kg',1.0,25,true),
  ( 78,'Naranja valencia a granel','Naranja valencia para jugo, por kilo','Frutas','Genérica','kg',1.0,30,true),
  ( 79,'Mandarina a granel','Mandarina dulce, venta por kilo','Frutas','Genérica','kg',1.0,18,true),
  ( 80,'Papaya a granel','Papaya madura, venta por kilo','Frutas','Genérica','kg',1.0,12,true),
  ( 81,'Piña gold a granel','Piña gold, venta por kilo','Frutas','Genérica','kg',1.0,10,true),
  ( 82,'Aguacate Hass a granel','Aguacate Hass, venta por kilo','Frutas','Genérica','kg',1.0,14,true),
  ( 83,'Limón Tahití a granel','Limón Tahití, venta por kilo','Frutas','Genérica','kg',1.0,16,true),
  ( 84,'Fresa a granel','Fresa fresca, venta por kilo','Frutas','Genérica','kg',1.0,6,true),
  ( 85,'Mango de azúcar a granel','Mango de azúcar maduro, por kilo','Frutas','Genérica','kg',1.0,12,true),
  -- FRUTAS Y VERDURAS · Verduras y tubérculos -------------------------------
  ( 86,'Papa pastusa a granel','Papa pastusa, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,45,true),
  ( 87,'Papa criolla a granel','Papa criolla, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,16,true),
  ( 88,'Cebolla cabezona a granel','Cebolla cabezona blanca, por kilo','Verduras y tubérculos','Genérica','kg',1.0,26,true),
  ( 89,'Cebolla larga a granel','Cebolla larga, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,10,true),
  ( 90,'Tomate chonto a granel','Tomate chonto, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,22,true),
  ( 91,'Zanahoria a granel','Zanahoria fresca, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,18,true),
  ( 92,'Yuca a granel','Yuca fresca, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,20,true),
  ( 93,'Plátano verde a granel','Plátano verde, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,24,true),
  ( 94,'Habichuela a granel','Habichuela fresca, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,8,true),
  ( 95,'Pimentón verde a granel','Pimentón verde, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,10,true),
  ( 96,'Lechuga crespa unidad','Lechuga crespa fresca, unidad','Verduras y tubérculos','Genérica','und',1.0,15,true),
  ( 97,'Cilantro a granel','Cilantro fresco, venta por kilo','Verduras y tubérculos','Genérica','kg',1.0,4,true),
  ( 98,'Mazorca de maíz unidad','Mazorca de maíz tierno, unidad','Verduras y tubérculos','Genérica','und',1.0,20,true),
  -- PANADERÍA Y SNACKS ------------------------------------------------------
  ( 99,'Pan tajado Bimbo 500 g','Pan de molde blanco x 500 g','Panadería y snacks','Bimbo','und',1.0,22,true),
  (100,'Pan blanco artesanal unidad','Pan blanco horneado del día, unidad','Panadería y snacks','Genérica','und',1.0,40,true),
  (101,'Tostadas Ramo 250 g','Tostadas de trigo x 250 g','Panadería y snacks','Ramo','und',1.0,16,true),
  (102,'Galletas Festival Chocolate x 12','Galletas sabor chocolate, paquete x 12','Panadería y snacks','Festival','und',1.0,30,false),
  (103,'Papas Margarita Pollo 105 g','Papas fritas sabor pollo x 105 g','Panadería y snacks','Margarita','und',1.0,36,false),
  (104,'Detodito Mix 200 g','Pasabocas mixtos x 200 g','Panadería y snacks','Detodito','und',1.0,25,false),
  (105,'Chocolatina Jet 12 g','Chocolate con leche x 12 g','Panadería y snacks','Jet','und',1.0,60,false),
  (106,'Galleta Tosh Blanca 300 g','Galletas de avena x 300 g','Panadería y snacks','Tosh','und',1.0,18,false),
  (107,'Maní La Especial 250 g','Maní tostado salado x 250 g','Panadería y snacks','La Especial','und',1.0,12,false),
  -- ASEO Y LIMPIEZA ---------------------------------------------------------
  (108,'Detergente Fab 900 g','Detergente en polvo x 900 g','Aseo y limpieza','Fab','und',1.0,22,false),
  (109,'Detergente Ariel 1 kg','Detergente en polvo x 1 kg','Aseo y limpieza','Ariel','und',1.0,18,false),
  (110,'Jabón en barra Rinso 300 g','Jabón para ropa x 300 g','Aseo y limpieza','Rinso','und',1.0,30,false),
  (111,'Suavizante Suavitel 800 ml','Suavizante de telas x 800 ml','Aseo y limpieza','Suavitel','lt',0.8,15,false),
  (112,'Limpiador Fabuloso Lavanda 1 L','Limpiador desinfectante x 1 L','Aseo y limpieza','Fabuloso','lt',1.0,20,false),
  (113,'Blanqueador Axión 1 L','Blanqueador con aroma x 1 L','Aseo y limpieza','Axión','lt',1.0,18,false),
  (114,'Limpiavidrios Brilla 500 ml','Limpiavidrios multiusos x 500 ml','Aseo y limpieza','Brilla','lt',0.5,10,false),
  (115,'Jabón de loza Loza Limpia 500 g','Jabón en crema para loza x 500 g','Aseo y limpieza','Loza Limpia','und',1.0,20,false),
  (116,'Bolsas de basura Semper x 30','Bolsas grandes con amarre x 30','Aseo y limpieza','Semper','und',1.0,25,false),
  (117,'Ambientador Glade Lavanda 300 ml','Aerosol ambiental x 300 ml','Aseo y limpieza','Glade','und',1.0,12,false),
  (118,'Escoba de cerda plástica','Escoba con cabo metálico, unidad','Aseo y limpieza','Genérica','und',1.0,8,false),
  (119,'Trapero de microfibra','Trapero con cabo, unidad','Aseo y limpieza','Genérica','und',1.0,6,false),
  (120,'Esponja multiusos x 3','Esponja abrasiva, paquete x 3','Aseo y limpieza','Genérica','und',1.0,20,false),
  -- CUIDADO PERSONAL --------------------------------------------------------
  (121,'Jabón Protex 110 g','Jabón antibacterial x 110 g','Cuidado personal','Protex','und',1.0,40,false),
  (122,'Jabón líquido Dove 500 ml','Jabón líquido hidratante x 500 ml','Cuidado personal','Dove','lt',0.5,12,false),
  (123,'Crema dental Colgate 90 g','Crema dental triple acción x 90 g','Cuidado personal','Colgate','und',1.0,30,false),
  (124,'Cepillo dental Familia x 2','Cepillo de dientes, paquete x 2','Cuidado personal','Familia','und',1.0,18,false),
  (125,'Desodorante Rexona 150 ml','Desodorante roll-on x 150 ml','Cuidado personal','Rexona','und',1.0,10,false),
  (126,'Shampoo Sedal 340 ml','Shampoo para cabello rizado x 340 ml','Cuidado personal','Sedal','lt',0.34,12,false),
  (127,'Crema corporal Nivea 400 ml','Crema humectante x 400 ml','Cuidado personal','Nivea','und',1.0,8,false),
  (128,'Toallas higiénicas Nosotras x 10','Toallas con alas, paquete x 10','Cuidado personal','Nosotras','und',1.0,20,false),
  (129,'Máquina de afeitar Gillette x 3','Afeitadora desechable, paquete x 3','Cuidado personal','Gillette','und',1.0,15,false),
  (130,'Papel higiénico Familia x 4','Papel higiénico doble hoja x 4 rollos','Cuidado personal','Familia','und',1.0,30,false),
  -- FERRETERÍA · Herramientas manuales --------------------------------------
  (131,'Martillo Truper 16 oz','Martillo de uña con mango de fibra','Herramientas manuales','Truper','und',1.0,6,false),
  (132,'Destornillador Stanley plano 6 pulg','Destornillador plano punta 1/4 pulg','Herramientas manuales','Stanley','und',1.0,8,false),
  (133,'Juego de llaves Pretul x 10','Llaves mixtas milimétricas x 10 piezas','Herramientas manuales','Pretul','und',1.0,4,false),
  (134,'Alicate de presión Pretul 10 pulg','Alicate de presión ajustable','Herramientas manuales','Pretul','und',1.0,5,false),
  (135,'Cinta métrica Stanley 5 m','Flexómetro con freno x 5 m','Herramientas manuales','Stanley','und',1.0,10,false),
  (136,'Taladro percutor Bosch 600 W','Taladro percutor 1/2 pulg, 600 W','Herramientas manuales','Bosch','und',1.0,3,false),
  (137,'Sierra circular Makita 1400 W','Sierra circular 7-1/4 pulg, 1400 W','Herramientas manuales','Makita','und',1.0,2,false),
  (138,'Juego de brocas DeWalt x 13','Brocas para concreto x 13 piezas','Herramientas manuales','DeWalt','und',1.0,6,false),
  -- FERRETERÍA · Plomería ---------------------------------------------------
  (139,'Tubo PVC Pavco 1/2 pulg x 3 m','Tubo presión 1/2 pulg, 3 m','Plomería','Pavco','und',1.0,20,false),
  (140,'Codo PVC Pavco 1/2 pulg','Codo a 90 grados, 1/2 pulg','Plomería','Pavco','und',1.0,50,false),
  (141,'Llave de paso Gerfor 1/2 pulg','Llave de bola para agua, 1/2 pulg','Plomería','Gerfor','und',1.0,12,false),
  (142,'Cinta teflón 12 mm','Cinta selladora para rosca x 12 mm','Plomería','Genérica','und',1.0,30,false),
  (143,'Sifón flexible 1-1/2 pulg','Sifón plástico para lavaplatos','Plomería','Genérica','und',1.0,8,false),
  -- FERRETERÍA · Eléctrico e iluminación ------------------------------------
  (144,'Bombillo LED Grival 9 W','Bombillo LED luz blanca, 9 W','Eléctrico e iluminación','Grival','und',1.0,24,false),
  (145,'Cable eléctrico 12 AWG por metro','Cable de cobre calibre 12, metro','Eléctrico e iluminación','Genérica','und',1.0,50,false),
  (146,'Tomacorriente doble Grival','Tomacorriente polarizado doble','Eléctrico e iluminación','Grival','und',1.0,18,false),
  (147,'Breaker monofásico 20 A','Interruptor automático 20 A','Eléctrico e iluminación','Genérica','und',1.0,10,false),
  (148,'Cinta aislante 3M 18 mm','Cinta aislante negra x 18 mm','Eléctrico e iluminación','3M','und',1.0,40,false),
  -- FERRETERÍA · Pinturas y adhesivos ---------------------------------------
  (149,'Pintura blanca Pintuco 1 galón','Vinilo tipo 1 blanco, galón','Pinturas y adhesivos','Pintuco','und',1.0,8,false),
  (150,'Esmalte sintético negro 1/4 galón','Esmalte brillante negro, cuarto de galón','Pinturas y adhesivos','Pintuco','und',1.0,6,false),
  (151,'Brocha de cerda 3 pulg','Brocha para pintura, 3 pulg','Pinturas y adhesivos','Genérica','und',1.0,15,false),
  (152,'Rodillo de felpa 9 pulg','Rodillo con mango, 9 pulg','Pinturas y adhesivos','Genérica','und',1.0,10,false),
  (153,'Pegante Loctite Super Bonder 3 g','Adhesivo instantáneo x 3 g','Pinturas y adhesivos','Loctite','und',1.0,12,false),
  (154,'Silicona Sika transparente 300 ml','Sellante de silicona neutra x 300 ml','Pinturas y adhesivos','Sika','und',1.0,14,false),
  (155,'Cemento gris Abracol 50 kg','Cemento Portland, bulto x 50 kg','Pinturas y adhesivos','Abracol','und',1.0,10,false),
  (156,'Tornillo autoperforante 8x1 x 100','Tornillo punta broca, caja x 100','Ferretería','Genérica','und',1.0,25,false),
  (157,'Chazo plástico 8 mm x 100','Chazo con tornillo, caja x 100','Ferretería','Genérica','und',1.0,20,false),
  -- PAPELERÍA ---------------------------------------------------------------
  (158,'Cuaderno Norma 100 hojas','Cuaderno universitario rayado x 100 hojas','Papelería','Norma','und',1.0,30,false),
  (159,'Bolígrafo BIC negro','Esfero punta fina tinta negra','Papelería','BIC','und',1.0,60,false),
  (160,'Lápiz Faber-Castell HB','Lápiz grafito HB con borrador','Papelería','Faber-Castell','und',1.0,50,false),
  (161,'Borrador Pelikan blanco','Borrador de nata, unidad','Papelería','Pelikan','und',1.0,25,false),
  (162,'Resma papel carta 500 hojas','Papel bond 75 g, resma x 500 hojas','Papelería','Scribe','und',1.0,6,false),
  (163,'Colores Faber-Castell x 12','Lápices de color, caja x 12','Papelería','Faber-Castell','und',1.0,15,false),
  (164,'Marcador Kiut negro','Marcador permanente punta gruesa','Papelería','Kiut','und',1.0,20,false),
  (165,'Cinta adhesiva transparente','Cinta pegante 18 mm x 33 m','Papelería','Genérica','und',1.0,30,false),
  -- MASCOTAS ----------------------------------------------------------------
  (166,'Concentrado Purina Dog Chow 3 kg','Alimento seco para perro adulto x 3 kg','Mascotas','Purina','und',1.0,12,false),
  (167,'Concentrado Pedigree Adulto 2 kg','Alimento seco para perro adulto x 2 kg','Mascotas','Pedigree','und',1.0,10,false),
  (168,'Comida gato Whiskas 1 kg','Alimento seco para gato adulto x 1 kg','Mascotas','Whiskas','und',1.0,14,false),
  (169,'Snack canino Dogourmet 200 g','Galletas para perro x 200 g','Mascotas','Dogourmet','und',1.0,18,false),
  (170,'Arena sanitaria Ringo 4 kg','Arena aglutinante para gato x 4 kg','Mascotas','Ringo','und',1.0,8,false),
  -- HOGAR Y DESECHABLES -----------------------------------------------------
  (171,'Vasos desechables Darnel x 50','Vaso plástico 7 oz, paquete x 50','Hogar y desechables','Darnel','und',1.0,25,false),
  (172,'Platos desechables Semper x 20','Plato plástico 9 pulg, paquete x 20','Hogar y desechables','Semper','und',1.0,20,false),
  (173,'Servilletas Carvajal x 100','Servilleta de papel, paquete x 100','Hogar y desechables','Carvajal','und',1.0,30,false),
  (174,'Papel aluminio 7.5 m','Rollo de papel aluminio x 7.5 m','Hogar y desechables','Genérica','und',1.0,12,false),
  (175,'Film plástico adherente 30 m','Rollo de vinipel x 30 m','Hogar y desechables','Genérica','und',1.0,15,false),
  (176,'Fósforos x 10 cajas','Fósforos de seguridad, paquete x 10','Hogar y desechables','Genérica','und',1.0,40,false),
  (177,'Velas blancas x 6','Velas de parafina, paquete x 6','Hogar y desechables','Genérica','und',1.0,18,false)
) AS v(seq, name, descr, cat, brand, unit, base_qty, base_stock, perish);

-- ----------------------------------------------------------------------------
-- 6. Validación previa: toda categoría / marca / unidad referenciada existe
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c.seq || ':' || c.name, ', ' ORDER BY c.seq)
    INTO v_missing
  FROM _seed_catalog c
  LEFT JOIN public.product_categories pc ON pc.name = c.cat
  LEFT JOIN public.brands            b  ON b.name  = c.brand
  LEFT JOIN public.unit_types        ut ON ut.abbreviation = c.unit
  WHERE pc.id IS NULL OR b.id IS NULL OR ut.id IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAROX seed: categoría, marca o unidad inexistente para: %', v_missing;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Productos
--    Código de barras EAN-13 válido: '7701' + seq(8) + dígito de control.
--    Se omite el producto si ya existe uno con el mismo nombre y marca.
-- ----------------------------------------------------------------------------
INSERT INTO public.products
  (name, description, category_id, brand_id, unit_type_id,
   created_by, base_quantity, barcode, is_active)
SELECT
  c.name,
  c.descr,
  pc.id,
  b.id,
  ut.id,
  ctx.admin_id,
  c.base_qty,
  '7701' || lpad(c.seq::text, 8, '0') || (
    (10 - (
      SELECT sum(substr('7701' || lpad(c.seq::text, 8, '0'), g, 1)::int
                 * CASE WHEN g % 2 = 1 THEN 1 ELSE 3 END)
      FROM generate_series(1, 12) AS g
    ) % 10) % 10
  )::text,
  true
FROM _seed_catalog c
JOIN public.product_categories pc ON pc.name = c.cat
JOIN public.brands            b  ON b.name  = c.brand
JOIN public.unit_types        ut ON ut.abbreviation = c.unit
CROSS JOIN _seed_ctx ctx
WHERE NOT EXISTS (
  SELECT 1
  FROM public.products p2
  WHERE p2.name = c.name AND p2.brand_id = b.id
)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 8. Stock por tienda
--    Cantidad = base_stock ajustada por tienda y producto, con dos casos
--    forzados para que el demo tenga estados reales:
--      · 1 de cada 19 pares  → sin stock (quantity = 0)
--      · 1 de cada 11 pares  → bajo umbral (12% del stock típico)
--    umbral = 20% del stock típico. Perecederos llevan caducidad futura.
-- ----------------------------------------------------------------------------
INSERT INTO public.stock (product_id, store_id, quantity, threshold, expiry_date)
SELECT
  p.id,
  s.id,
  CASE
    WHEN (c.seq + s.id) % 19 = 0 THEN 0::numeric(12,3)
    WHEN (c.seq + s.id) % 11 = 0 THEN round(c.base_stock * 0.12, 3)
    ELSE round(c.base_stock * (0.75 + ((c.seq + s.id) % 6) * 0.10), 3)
  END,
  round(c.base_stock * 0.20, 3),
  CASE
    WHEN c.perish THEN current_date + ((((c.seq * 3 + s.id) % 45) + 2)::integer)
    ELSE NULL
  END
FROM _seed_catalog c
JOIN public.brands   b ON b.name = c.brand
JOIN public.products p ON p.name = c.name AND p.brand_id = b.id
JOIN public.stores   s ON s.is_active
WHERE NOT EXISTS (
  SELECT 1
  FROM public.stock st
  WHERE st.product_id = p.id AND st.store_id = s.id
);

-- ----------------------------------------------------------------------------
-- 9. Alertas stock_low coherentes con las cantidades sembradas
--    El sistema solo evalúa alertas en transiciones, así que las
--    materializamos para los pares que quedaron en o bajo el umbral.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r     record;
  v_n   integer := 0;
BEGIN
  FOR r IN
    SELECT st.store_id, st.product_id
    FROM public.stock st
    JOIN public.products p ON p.id = st.product_id
    JOIN public.brands   b ON b.id = p.brand_id
    JOIN _seed_catalog   c ON c.name = p.name AND c.brand = b.name
    WHERE st.threshold IS NOT NULL
      AND st.quantity <= st.threshold
  LOOP
    PERFORM public.internal_eval_stock_alert(r.store_id, r.product_id);
    v_n := v_n + 1;
  END LOOP;

  RAISE NOTICE 'FAROX seed: % pares producto-tienda evaluados como stock bajo', v_n;
END $$;

-- ----------------------------------------------------------------------------
-- 10. Resumen
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_products integer;
  v_brands   integer;
  v_cats     integer;
  v_stock    integer;
  v_stores   integer;
  v_alerts   integer;
BEGIN
  SELECT count(*) INTO v_products FROM public.products;
  SELECT count(*) INTO v_brands   FROM public.brands;
  SELECT count(*) INTO v_cats     FROM public.product_categories;
  SELECT count(*) INTO v_stock    FROM public.stock;
  SELECT count(*) INTO v_stores   FROM public.stores WHERE is_active;
  SELECT count(*) INTO v_alerts   FROM public.alerts WHERE type = 'stock_low' AND resolved_at IS NULL;

  RAISE NOTICE 'FAROX seed OK → productos: %, marcas: %, categorías: %, tiendas activas: %, filas de stock: %, alertas stock_low abiertas: %',
    v_products, v_brands, v_cats, v_stores, v_stock, v_alerts;

  IF v_stores = 0 THEN
    RAISE WARNING 'FAROX seed: no hay tiendas activas, así que no se generó stock. Crea una tienda y vuelve a correr el script.';
  END IF;
END $$;

COMMIT;
