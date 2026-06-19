-- =============================================================================
-- 0000_init.sql  —  Marketplace core schema (PostgreSQL 16)
-- Single Source of Truth. Strict constraints. Integer money (BIGINT cents).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE user_role       AS ENUM ('customer', 'vendor_owner', 'vendor_staff', 'admin');
CREATE TYPE vendor_status   AS ENUM ('pending', 'active', 'suspended', 'closed');
CREATE TYPE product_status  AS ENUM ('draft', 'active', 'archived');
CREATE TYPE cart_status     AS ENUM ('active', 'converted', 'abandoned');
CREATE TYPE order_status    AS ENUM (
  'pending_payment', 'paid', 'processing', 'shipped',
  'delivered', 'cancelled', 'refunded'
);
CREATE TYPE payment_status  AS ENUM (
  'initiated', 'authorized', 'captured', 'failed',
  'refunded', 'partially_refunded'
);
CREATE TYPE reservation_status AS ENUM ('held', 'committed', 'released', 'expired');
CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'delivered', 'failed');

-- ---------------------------------------------------------------------------
-- Reusable updated_at trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- USERS
-- =============================================================================
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id    BIGINT UNIQUE,                 -- nullable: web-only users
  email          CITEXT UNIQUE,                 -- nullable: telegram-only users
  password_hash  TEXT,                          -- argon2id; null for TG-only
  role           user_role NOT NULL DEFAULT 'customer',
  first_name     TEXT,
  last_name      TEXT,
  username       TEXT,
  phone          TEXT,
  language_code  TEXT NOT NULL DEFAULT 'en',
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A user must be reachable by at least one identity:
  CONSTRAINT chk_users_identity CHECK (telegram_id IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX idx_users_telegram ON users (telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX idx_users_role     ON users (role);
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- VENDORS  +  membership
-- =============================================================================
CREATE TABLE vendors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  status          vendor_status NOT NULL DEFAULT 'pending',
  commission_bps  INTEGER NOT NULL DEFAULT 1000,   -- basis points: 1000 = 10.00%
  payout_details  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_vendor_commission CHECK (commission_bps BETWEEN 0 AND 10000)
);
CREATE INDEX idx_vendors_owner  ON vendors (owner_id);
CREATE INDEX idx_vendors_status ON vendors (status);
CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vendor_members (
  vendor_id  UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff',        -- 'owner' | 'manager' | 'staff'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vendor_id, user_id)
);
CREATE INDEX idx_vendor_members_user ON vendor_members (user_id);

-- =============================================================================
-- CATEGORIES  (self-referencing tree)
-- =============================================================================
CREATE TABLE categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  UUID REFERENCES categories(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_categories_parent ON categories (parent_id);

-- =============================================================================
-- PRODUCTS  +  VARIANTS (stock lives on the variant)
-- =============================================================================
CREATE TABLE products (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id    UUID NOT NULL REFERENCES vendors(id)    ON DELETE CASCADE,
  category_id  UUID REFERENCES categories(id)          ON DELETE SET NULL,
  title        TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  status       product_status NOT NULL DEFAULT 'draft',
  attributes   JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_tsv   tsvector,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, slug)
);
CREATE INDEX idx_products_vendor_status ON products (vendor_id, status);
CREATE INDEX idx_products_category      ON products (category_id);
CREATE INDEX idx_products_search        ON products USING GIN (search_tsv);
CREATE INDEX idx_products_attributes    ON products USING GIN (attributes);
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Maintain full-text search vector automatically
CREATE OR REPLACE FUNCTION products_tsv_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_tsv :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_products_tsv BEFORE INSERT OR UPDATE OF title, description
  ON products FOR EACH ROW EXECUTE FUNCTION products_tsv_update();

-- A variant = a sellable SKU (e.g. "Red / XL"). Stock + price live here.
CREATE TABLE product_variants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku           TEXT NOT NULL UNIQUE,
  options       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"size":"XL","color":"Red"}
  price_cents   BIGINT NOT NULL,                      -- integer money
  currency      CHAR(3) NOT NULL DEFAULT 'USD',
  stock_qty     INTEGER NOT NULL DEFAULT 0,           -- physically on hand
  reserved_qty  INTEGER NOT NULL DEFAULT 0,           -- held during checkout
  version       INTEGER NOT NULL DEFAULT 0,           -- optimistic-lock counter
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- ===== THE CONSTRAINTS THAT PREVENT BAD STATE =====
  CONSTRAINT chk_stock_nonneg      CHECK (stock_qty >= 0),
  CONSTRAINT chk_reserved_nonneg   CHECK (reserved_qty >= 0),
  CONSTRAINT chk_reserved_le_stock CHECK (reserved_qty <= stock_qty),
  CONSTRAINT chk_price_nonneg      CHECK (price_cents >= 0)
);
CREATE INDEX idx_variants_product ON product_variants (product_id);
CREATE TRIGGER trg_variants_updated_at BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- available_qty is always computed as (stock_qty - reserved_qty) in queries.

-- =============================================================================
-- CARTS  +  ITEMS (snapshotted unit price)
-- =============================================================================
CREATE TABLE carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      cart_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Exactly one ACTIVE cart per user (other statuses unconstrained):
CREATE UNIQUE INDEX idx_one_active_cart ON carts (user_id) WHERE status = 'active';
CREATE TRIGGER trg_carts_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id           UUID NOT NULL REFERENCES carts(id)            ON DELETE CASCADE,
  variant_id        UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  qty               INTEGER NOT NULL,
  unit_price_cents  BIGINT NOT NULL,            -- snapshot at add-time
  added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cart_item_qty CHECK (qty > 0),
  UNIQUE (cart_id, variant_id)                  -- merge qty rather than duplicate
);
CREATE INDEX idx_cart_items_cart ON cart_items (cart_id);

-- =============================================================================
-- ORDERS  +  ITEMS  +  STATUS HISTORY (state machine tracker)
-- =============================================================================
CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     TEXT NOT NULL UNIQUE,
  user_id          UUID NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
  vendor_id        UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  status           order_status NOT NULL DEFAULT 'pending_payment',
  subtotal_cents   BIGINT NOT NULL,
  shipping_cents   BIGINT NOT NULL DEFAULT 0,
  total_cents      BIGINT NOT NULL,
  currency         CHAR(3) NOT NULL DEFAULT 'USD',
  shipping_address JSONB,
  idempotency_key  TEXT UNIQUE,                 -- prevents duplicate order creation
  placed_via       TEXT NOT NULL,              -- 'web' | 'tma' | 'bot'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_order_amounts CHECK (
    subtotal_cents >= 0 AND shipping_cents >= 0 AND total_cents >= 0
    AND total_cents = subtotal_cents + shipping_cents
  ),
  CONSTRAINT chk_order_placed_via CHECK (placed_via IN ('web', 'tma', 'bot'))
);
CREATE INDEX idx_orders_vendor_status ON orders (vendor_id, status, created_at DESC);
CREATE INDEX idx_orders_user          ON orders (user_id, created_at DESC);
CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               UUID NOT NULL REFERENCES orders(id)           ON DELETE CASCADE,
  variant_id             UUID NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_title_snapshot TEXT NOT NULL,
  options_snapshot       JSONB NOT NULL,
  unit_price_cents       BIGINT NOT NULL,
  qty                    INTEGER NOT NULL,
  total_cents            BIGINT NOT NULL,
  CONSTRAINT chk_order_item_qty   CHECK (qty > 0),
  CONSTRAINT chk_order_item_total CHECK (total_cents = unit_price_cents * qty)
);
CREATE INDEX idx_order_items_order ON order_items (order_id);

-- Append-only audit log of every status transition (compliance + debugging).
-- Illegal transitions are rejected by the trigger below.
CREATE TABLE order_status_history (
  id          BIGSERIAL PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status   order_status NOT NULL,
  changed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_history_order ON order_status_history (order_id, created_at);

-- DB-level state machine guard: reject illegal transitions defensively.
CREATE OR REPLACE FUNCTION assert_valid_order_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.from_status IS NULL THEN
    -- initial insert; allow only the start state
    IF NEW.to_status <> 'pending_payment' THEN
      RAISE EXCEPTION 'Order must start in pending_payment, got %', NEW.to_status;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT (
    (NEW.from_status = 'pending_payment' AND NEW.to_status IN ('paid', 'cancelled')) OR
    (NEW.from_status = 'paid'            AND NEW.to_status IN ('processing', 'cancelled', 'refunded')) OR
    (NEW.from_status = 'processing'      AND NEW.to_status IN ('shipped', 'cancelled')) OR
    (NEW.from_status = 'shipped'         AND NEW.to_status IN ('delivered', 'cancelled')) OR
    (NEW.from_status = 'delivered'       AND NEW.to_status IN ('refunded'))
  ) THEN
    RAISE EXCEPTION 'Illegal order transition: % -> %', NEW.from_status, NEW.to_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_order_transition BEFORE INSERT ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION assert_valid_order_transition();

-- =============================================================================
-- PAYMENTS  +  webhook dedupe
-- =============================================================================
CREATE TABLE payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  provider      TEXT NOT NULL,                  -- 'stripe' | 'telegram' | local
  provider_ref  TEXT,                           -- provider charge/intent id
  status        payment_status NOT NULL DEFAULT 'initiated',
  amount_cents  BIGINT NOT NULL,
  currency      CHAR(3) NOT NULL,
  raw_payload   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_payment_amount CHECK (amount_cents >= 0),
  -- one logical payment per provider reference (webhook idempotency anchor):
  CONSTRAINT uq_payment_provider_ref UNIQUE (provider, provider_ref)
);
CREATE INDEX idx_payments_order ON payments (order_id);
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Dedupe incoming webhook deliveries (providers retry aggressively).
CREATE TABLE payment_webhook_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type        TEXT,
  payload           JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  CONSTRAINT uq_webhook_event UNIQUE (provider, provider_event_id)
);
CREATE INDEX idx_webhook_unprocessed ON payment_webhook_events (received_at)
  WHERE processed_at IS NULL;

-- =============================================================================
-- STOCK RESERVATIONS (TTL-based holds; consistency keystone)
-- =============================================================================
CREATE TABLE stock_reservations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  order_id    UUID REFERENCES orders(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL,
  status      reservation_status NOT NULL DEFAULT 'held',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_reservation_qty CHECK (qty > 0)
);
-- Sweeper query targets this partial index to release expired holds:
CREATE INDEX idx_reservations_expiry ON stock_reservations (expires_at)
  WHERE status = 'held';
CREATE INDEX idx_reservations_variant ON stock_reservations (variant_id);
CREATE INDEX idx_reservations_order   ON stock_reservations (order_id);
CREATE TRIGGER trg_reservations_updated_at BEFORE UPDATE ON stock_reservations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TRANSACTIONAL OUTBOX (at-least-once event delivery)
-- =============================================================================
CREATE TABLE outbox_events (
  id            BIGSERIAL PRIMARY KEY,
  aggregate     TEXT NOT NULL,                  -- 'inventory' | 'order' | 'cart'
  aggregate_id  UUID NOT NULL,
  event_type    TEXT NOT NULL,                  -- 'inventory.updated'
  payload       JSONB NOT NULL,
  trace_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at  TIMESTAMPTZ,                     -- NULL = not yet relayed
  attempts      INTEGER NOT NULL DEFAULT 0
);
-- Relay polls only unpublished rows in insertion order:
CREATE INDEX idx_outbox_unpublished ON outbox_events (id)
  WHERE published_at IS NULL;

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL,                    -- 'telegram' | 'web_push' | 'email'
  template    TEXT NOT NULL,                    -- 'order_shipped'
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  status      notification_status NOT NULL DEFAULT 'queued',
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  CONSTRAINT chk_notification_channel CHECK (channel IN ('telegram', 'web_push', 'email'))
);
CREATE INDEX idx_notifications_user   ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_queued ON notifications (created_at)
  WHERE status = 'queued';

COMMIT;
