import { io, type Socket } from 'socket.io-client';
import type { QueryClient } from '@tanstack/react-query';
import {
  EVENT,
  type InventoryUpdatedPayload,
  type OrderStatusChangedPayload,
} from '@repo/types';
import { env } from './env';
import { qk } from './queryKeys';

let socket: Socket | null = null;

export interface RealtimeAuth {
  token?: string;
  userId?: string;
  vendorId?: string;
}

/**
 * Connects Socket.IO and wires server events into TanStack Query — this is the
 * "real-time cache reconciliation engine". The server is the source of truth;
 * every event either patches the cache directly (cheap) or invalidates a key so
 * Query refetches authoritative state.
 */
export function connectRealtime(qc: QueryClient, auth: RealtimeAuth): Socket {
  if (socket) return socket;

  socket = io(env.wsUrl, {
    transports: ['websocket'],
    auth, // { token, userId, vendorId } — server joins user:/vendor: rooms
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  });

  // Inventory: patch the cached product instantly, then mark stale to refetch.
  socket.on(EVENT.INVENTORY_UPDATED, (p: InventoryUpdatedPayload) => {
    qc.setQueryData(qk.product(p.productId), (old: unknown) => {
      if (!old || typeof old !== 'object') return old;
      const prod = old as { variants?: Array<{ id: string; availableQty?: number; version?: number }> };
      if (!Array.isArray(prod.variants)) return old;
      return {
        ...prod,
        variants: prod.variants.map((v) =>
          v.id === p.variantId
            ? { ...v, availableQty: p.availableQty, version: p.version }
            : v,
        ),
      };
    });
    void qc.invalidateQueries({ queryKey: qk.product(p.productId) });
  });

  // Cart changed on ANOTHER device (e.g. user edited cart in the browser while
  // the TMA is open) -> reconcile this client's cart.
  socket.on(EVENT.CART_UPDATED, () => {
    void qc.invalidateQueries({ queryKey: qk.cart() });
  });

  // Order lifecycle -> refresh lists + the specific order.
  const onOrder = (p: OrderStatusChangedPayload) => {
    void qc.invalidateQueries({ queryKey: qk.orders() });
    void qc.invalidateQueries({ queryKey: qk.order(p.orderId) });
  };
  socket.on(EVENT.ORDER_CREATED, onOrder);
  socket.on(EVENT.ORDER_STATUS_CHANGED, onOrder);

  return socket;
}

/** Join/leave a product room so this client gets that product's stock updates. */
export function watchProduct(productId: string): void {
  socket?.emit('watch:product', productId);
}
export function unwatchProduct(productId: string): void {
  socket?.emit('unwatch:product', productId);
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}
