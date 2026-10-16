-- ============================================================================
-- FAROX — Sprint 1, paso 1/8: extensiones + enums (§7, §1)
-- Spec: `Base de datos FAROX.md` (autoritativa)
-- ============================================================================

-- 1. Extensiones -------------------------------------------------------------
-- FAROX solo trae pg_stat_statements/pgcrypto/uuid-ossp; PostGIS es necesario
-- para stores.location (D12) y pg_cron para los jobs diarios de alertas (§7.10).
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- NO pg_trgm todavía (D22): se añade junto a los GIN de búsqueda (~50.000 productos).

-- 2. Enums (§1) — 11 tipos nativos -------------------------------------------
-- Protocolo enum (§1): cada migración corre en 1 transacción ⇒ ALTER TYPE
-- ADD VALUE puede añadirse pero no usarse en la misma migración.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'movement_type' AND n.nspname = 'public') THEN
    CREATE TYPE public.movement_type AS ENUM ('entry', 'exit');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'order_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.order_status AS ENUM ('pending', 'in_route', 'delivered', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'order_item_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.order_item_status AS ENUM ('pending', 'received', 'partial');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'route_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.route_status AS ENUM ('planned', 'active', 'completed', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'stop_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.stop_status AS ENUM ('pending', 'arrived', 'completed', 'skipped');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'credit_status' AND n.nspname = 'public') THEN
    CREATE TYPE public.credit_status AS ENUM ('pending', 'paid', 'cancelled');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'payment_method' AND n.nspname = 'public') THEN
    CREATE TYPE public.payment_method AS ENUM ('cash', 'transfer', 'card', 'other');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'alert_type' AND n.nspname = 'public') THEN
    CREATE TYPE public.alert_type AS ENUM ('stock_low', 'expiry_soon', 'order_late', 'credit_overdue');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'chat_role' AND n.nspname = 'public') THEN
    CREATE TYPE public.chat_role AS ENUM ('user', 'assistant', 'tool');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'audit_action' AND n.nspname = 'public') THEN
    CREATE TYPE public.audit_action AS ENUM ('insert', 'update', 'delete');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE t.typname = 'contact_preference' AND n.nspname = 'public') THEN
    CREATE TYPE public.contact_preference AS ENUM ('whatsapp', 'phone', 'email');
  END IF;
END $$;

-- Fin paso 1/8.
