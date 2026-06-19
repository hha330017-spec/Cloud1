import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', [
  'customer',
  'vendor_owner',
  'vendor_staff',
  'admin',
]);

export const vendorStatus = pgEnum('vendor_status', [
  'pending',
  'active',
  'suspended',
  'closed',
]);

export const productStatus = pgEnum('product_status', [
  'draft',
  'active',
  'archived',
]);

export const cartStatus = pgEnum('cart_status', [
  'active',
  'converted',
  'abandoned',
]);

export const orderStatus = pgEnum('order_status', [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
]);

export const paymentStatus = pgEnum('payment_status', [
  'initiated',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'partially_refunded',
]);

export const reservationStatus = pgEnum('reservation_status', [
  'held',
  'committed',
  'released',
  'expired',
]);

export const notificationStatus = pgEnum('notification_status', [
  'queued',
  'sent',
  'delivered',
  'failed',
]);
