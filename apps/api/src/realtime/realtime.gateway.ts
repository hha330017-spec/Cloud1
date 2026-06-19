import { Inject, Logger, type OnModuleInit } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import {
  EVENT,
  PUBSUB_CHANNEL,
  room,
  type DomainEventEnvelope,
  type InventoryUpdatedPayload,
  type OrderStatusChangedPayload,
  type CartUpdatedPayload,
} from '@repo/types';
import { REDIS, REDIS_SUB } from '../redis/redis.module';

/**
 * The bridge from the event stream to live clients.
 *
 *   outbox -> relay -> Redis Pub/Sub (PUBSUB_CHANNEL)
 *                          |
 *                  this gateway subscribes
 *                          |
 *            emits to the right Socket.IO rooms
 *
 * The Socket.IO Redis ADAPTER (separate from our domain Pub/Sub) lets multiple
 * gateway replicas share rooms, so a client connected to pod A receives events
 * emitted from pod B.
 */
@WebSocketGateway({ cors: true, transports: ['websocket'] })
export class RealtimeGateway implements OnModuleInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server!: Server;

  constructor(
    @Inject(REDIS) private readonly pub: Redis,
    @Inject(REDIS_SUB) private readonly sub: Redis,
  ) {}

  onModuleInit(): void {
    // 1) Cross-replica room sync via the Socket.IO Redis adapter.
    //    Needs its own duplicate connections distinct from the domain sub.
    this.server.adapter(createAdapter(this.pub.duplicate(), this.pub.duplicate()));

    // 2) Subscribe to the domain event stream and fan out to rooms.
    void this.sub.subscribe(PUBSUB_CHANNEL).then(() => {
      this.logger.log(`subscribed to ${PUBSUB_CHANNEL}`);
    });
    this.sub.on('message', (_channel, message) => {
      try {
        this.dispatch(JSON.parse(message) as DomainEventEnvelope);
      } catch (err) {
        this.logger.error('failed to dispatch event', err as Error);
      }
    });
  }

  /** Authenticated handshake: client provides a JWT, we join its rooms. */
  handleConnection(client: Socket): void {
    // In production: verify client.handshake.auth.token (JWT) here and reject
    // if invalid. The decoded claims tell us which rooms the socket may join.
    const userId = client.handshake.auth?.userId as string | undefined;
    const vendorId = client.handshake.auth?.vendorId as string | undefined;
    if (userId) void client.join(room.user(userId));
    if (vendorId) void client.join(room.vendor(vendorId));

    // Clients explicitly subscribe to product rooms they're viewing:
    client.on('watch:product', (productId: string) =>
      client.join(room.product(productId)),
    );
    client.on('unwatch:product', (productId: string) =>
      client.leave(room.product(productId)),
    );
  }

  /** Route each event to the correct rooms based on its payload. */
  private dispatch(evt: DomainEventEnvelope): void {
    switch (evt.eventType) {
      case EVENT.INVENTORY_UPDATED: {
        const p = evt.payload as InventoryUpdatedPayload;
        this.server.to(room.product(p.productId)).emit(EVENT.INVENTORY_UPDATED, p);
        this.server.to(room.vendor(p.vendorId)).emit(EVENT.INVENTORY_UPDATED, p);
        break;
      }
      case EVENT.ORDER_CREATED:
      case EVENT.ORDER_STATUS_CHANGED: {
        const p = evt.payload as OrderStatusChangedPayload;
        this.server.to(room.user(p.userId)).emit(evt.eventType, p);
        this.server.to(room.vendor(p.vendorId)).emit(evt.eventType, p);
        this.server.to(room.order(p.orderId)).emit(evt.eventType, p);
        break;
      }
      case EVENT.CART_UPDATED: {
        const p = evt.payload as CartUpdatedPayload;
        // Reaches every device where the user has the app open (web + TMA).
        this.server.to(room.user(p.userId)).emit(EVENT.CART_UPDATED, p);
        break;
      }
      default:
        // payment.* events are consumed by the notifications worker, not WS.
        break;
    }
  }
}
