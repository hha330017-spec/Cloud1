-- =============================================================================
-- 0001_stock_functions.sql
-- Atomic, race-condition-safe inventory operations as DB functions.
-- These run inside a single statement, so the row lock + CHECK constraints
-- guarantee correctness even under massive concurrency.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- reserve_stock(): atomically hold N units if available.
-- Strategy: conditional UPDATE that only succeeds when enough free stock
-- exists. The WHERE clause is the gatekeeper; the CHECK constraint
-- (reserved_qty <= stock_qty) is the backstop. Returns true on success.
--
-- Two users buying the last item at the same millisecond:
--   - Both UPDATEs target the same row; Postgres serializes them via row lock.
--   - First commits: reserved_qty 0 -> 1 (available now 0).
--   - Second re-evaluates WHERE against the new row: fails the predicate,
--     0 rows updated -> returns false. No oversell. No deadlock.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reserve_stock(
  p_variant_id UUID,
  p_qty        INTEGER,
  p_order_id   UUID,
  p_ttl_seconds INTEGER DEFAULT 900
)
RETURNS TABLE (reservation_id UUID, success BOOLEAN) AS $$
DECLARE
  v_updated INTEGER;
  v_res_id  UUID;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'reserve_stock: qty must be positive (got %)', p_qty;
  END IF;

  UPDATE product_variants
     SET reserved_qty = reserved_qty + p_qty,
         version      = version + 1
   WHERE id = p_variant_id
     AND is_active = true
     AND (stock_qty - reserved_qty) >= p_qty;   -- only if enough is free

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN QUERY SELECT NULL::UUID, false;
    RETURN;
  END IF;

  INSERT INTO stock_reservations (variant_id, order_id, qty, status, expires_at)
  VALUES (p_variant_id, p_order_id, p_qty, 'held',
          now() + make_interval(secs => p_ttl_seconds))
  RETURNING id INTO v_res_id;

  RETURN QUERY SELECT v_res_id, true;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- commit_reservation(): on successful payment, convert a hold into a real
-- stock decrement. reserved_qty down, stock_qty down (item leaves inventory).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION commit_reservation(p_reservation_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_variant UUID;
  v_qty     INTEGER;
BEGIN
  UPDATE stock_reservations
     SET status = 'committed'
   WHERE id = p_reservation_id AND status = 'held'
  RETURNING variant_id, qty INTO v_variant, v_qty;

  IF v_variant IS NULL THEN
    RETURN false;   -- already committed/released/expired
  END IF;

  UPDATE product_variants
     SET stock_qty    = stock_qty - v_qty,
         reserved_qty = reserved_qty - v_qty,
         version      = version + 1
   WHERE id = v_variant;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- release_reservation(): payment failed / cart abandoned / TTL expired.
-- Frees the hold back to available stock. Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_reservation(p_reservation_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  v_variant UUID;
  v_qty     INTEGER;
BEGIN
  UPDATE stock_reservations
     SET status = 'released'
   WHERE id = p_reservation_id AND status = 'held'
  RETURNING variant_id, qty INTO v_variant, v_qty;

  IF v_variant IS NULL THEN
    RETURN false;
  END IF;

  UPDATE product_variants
     SET reserved_qty = reserved_qty - v_qty,
         version      = version + 1
   WHERE id = v_variant;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- sweep_expired_reservations(): called by a periodic BullMQ job.
-- Releases stale holds whose expires_at has passed. Batched to avoid long locks.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sweep_expired_reservations(p_limit INTEGER DEFAULT 500)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, variant_id, qty
      FROM stock_reservations
     WHERE status = 'held' AND expires_at < now()
     ORDER BY expires_at
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE stock_reservations SET status = 'expired' WHERE id = r.id;
    UPDATE product_variants
       SET reserved_qty = reserved_qty - r.qty,
           version      = version + 1
     WHERE id = r.variant_id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
