import { Inject, Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import {
  EVENT,
  PUBSUB_CHANNEL,
  type DomainEventEnvelope,
  type OrderStatusChangedPayload,
} from '@repo/types';
import { REDIS, REDIS_SUB } from '../redis/redis.module';

/**
 * Subscribes to the SAME domain-event stream the gateway uses, but instead of
 * pushing to sockets it enqueues durable BullMQ jobs. External calls (Telegram
 * sendMessage, email) are slow and flaky, so they never run in the request path
 * or the relay — they are retried by BullMQ with backoff (see bot worker).
 *
 * Idempotency: jobId is derived from the outbox event id, so even if the relay
 * delivers the same event twice, BullMQ de-duplicates the job.
 */
@Injectable()
export class NotificationsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsConsumer.name);
  private queue!: Queue;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDIS_SUB) private readonly sub: Redis,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue('notifications', { connection: this.redis });

    // NOTE: REDIS_SUB is shared with the gateway; ioredis delivers each
    // 'message' to every registered listener, so both consumers see all events.
    this.sub.on('message', (channel, message) => {
      if (channel !== PUBSUB_CHANNEL) return;
      try {
        void this.handle(JSON.parse(message) as DomainEventEnvelope);
      } catch (err) {
        this.logger.error('bad event payload', err as Error);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  private async handle(evt: DomainEventEnvelope): Promise<void> {
    let template: string | null = null;
    if (evt.eventType === EVENT.ORDER_STATUS_CHANGED) {
      const p = evt.payload as OrderStatusChangedPayload;
      template = this.templateForStatus(p.toStatus);
    } else if (evt.eventType === EVENT.PAYMENT_SUCCEEDED) {
      template = 'payment_succeeded';
    }
    if (!template) return;

    await this.queue.add(
      'send',
      { template, event: evt },
      {
        jobId: `notif:${evt.id}`, // idempotent: dedupes repeat deliveries
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    );
  }

  private templateForStatus(status: string): string | null {
    switch (status) {
      case 'paid':
        return 'order_paid';
      case 'shipped':
        return 'order_shipped';
      case 'delivered':
        return 'order_delivered';
      case 'cancelled':
        return 'order_cancelled';
      case 'refunded':
        return 'order_refunded';
      default:
        return null;
    }
  }
}
