import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type Job, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { schema, type Database } from '@repo/db';
import { DB } from '../database/database.module';
import { REDIS } from '../redis/redis.module';
import { RedisLock } from '../common/redis-lock';
import { OrderService } from '../orders/order.service';
import { verifyHmacSignature } from './payment-signature';

const QUEUE = 'payment-webhooks';

/** Provider-agnostic normalised view of a webhook we care about. */
interface NormalizedEvent {
  providerEventId: string;
  eventType: string;
  orderId: string;
  providerRef: string;
  amountCents: number;
  currency: string;
  succeeded: boolean;
}

interface FinalizeJob {
  provider: string;
  event: NormalizedEvent;
}

/**
 * Payment webhook resilience.
 *
 * THE DROPOUT SCENARIO: payment succeeds at the gateway, but the user closes the
 * browser before the client-side callback runs. The order would be stuck in
 * pending_payment forever if we relied on the client. The webhook is the
 * authoritative, out-of-band confirmation that fixes this.
 *
 * Flow:
 *   intake() [synchronous, must be FAST so the provider gets its 200 and stops
 *   retrying]:
 *     1. verify the signature against the raw bytes,
 *     2. normalise the event,
 *     3. DEDUPLICATE via payment_webhook_events unique (provider, event_id) —
 *        providers retry aggressively; this makes processing exactly-once,
 *     4. enqueue a BullMQ job and return.
 *
 *   finalize() [asynchronous worker]:
 *     5. take a DISTRIBUTED LOCK on the order (serialises duplicate deliveries
 *        across pods + any concurrent client confirmation),
 *     6. in one DB transaction: update the payment row, and if the order is
 *        still pending_payment, transition it to 'paid' (which COMMITS the
 *        stock_reservations atomically); idempotent if already paid,
 *     7. mark the webhook event processed.
 */
@Injectable()
export class PaymentWebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentWebhookService.name);
  private queue!: Queue<FinalizeJob>;
  private worker!: Worker<FinalizeJob>;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly lock: RedisLock,
    private readonly orders: OrderService,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue<FinalizeJob>(QUEUE, { connection: this.redis });
    this.worker = new Worker<FinalizeJob>(QUEUE, (job) => this.finalize(job), {
      connection: this.redis,
      concurrency: 5,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`finalize job ${job?.id} failed: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  // ----------------------- SYNCHRONOUS INTAKE -----------------------
  async intake(
    provider: string,
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<{ received: true }> {
    const secret = this.secretFor(provider);
    verifyHmacSignature({ rawBody, signatureHeader, secret });

    const event = this.normalize(provider, rawBody);

    // Dedupe: unique (provider, provider_event_id). If the row already exists,
    // this is a retry/duplicate -> ack without reprocessing.
    const inserted = await this.db
      .insert(schema.paymentWebhookEvents)
      .values({
        provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        payload: JSON.parse(rawBody.toString('utf8')),
      })
      .onConflictDoNothing({
        target: [
          schema.paymentWebhookEvents.provider,
          schema.paymentWebhookEvents.providerEventId,
        ],
      })
      .returning({ id: schema.paymentWebhookEvents.id });

    if (inserted.length === 0) {
      this.logger.debug(`duplicate webhook ${provider}/${event.providerEventId} ignored`);
      return { received: true };
    }

    // Only enqueue for events that actually require action.
    if (event.succeeded) {
      await this.queue.add('finalize', { provider, event }, {
        jobId: `pay:${provider}:${event.providerEventId}`, // idempotent enqueue
        attempts: 8,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      });
    }

    return { received: true };
  }

  // ----------------------- ASYNC FINALIZE -----------------------
  private async finalize(job: Job<FinalizeJob>): Promise<void> {
    const { event, provider } = job.data;
    const lockKey = `lock:order:${event.orderId}`;

    // The distributed lock serialises duplicate deliveries across pods and any
    // concurrent client confirmation. We deliberately do NOT open an outer DB
    // transaction here: transitionStatus opens its own (with SELECT ... FOR
    // UPDATE), and nesting a second pooled connection that locks the same row
    // would self-deadlock. The lock + the idempotency gate keep this correct.
    await this.lock.withLock(
      lockKey,
      async () => {
        // 1) Upsert the payment record to 'captured' (idempotent).
        await this.db
          .insert(schema.payments)
          .values({
            orderId: event.orderId,
            provider,
            providerRef: event.providerRef,
            status: 'captured',
            amountCents: event.amountCents,
            currency: event.currency,
          })
          .onConflictDoUpdate({
            target: [schema.payments.provider, schema.payments.providerRef],
            set: { status: 'captured', updatedAt: new Date() },
          });

        // 2) Idempotency gate: only transition if still awaiting payment.
        const [order] = await this.db
          .select({ status: schema.orders.status })
          .from(schema.orders)
          .where(eq(schema.orders.id, event.orderId))
          .limit(1);

        if (!order) {
          throw new UnrecoverableError(`order ${event.orderId} not found`);
        }

        if (order.status === 'pending_payment') {
          // transitionStatus runs its own transaction: locks the order row,
          // validates, writes history, COMMITS the stock_reservations, and emits
          // order.status_changed — all atomically. If it throws, BullMQ retries.
          await this.orders.transitionStatus({
            orderId: event.orderId,
            toStatus: 'paid',
            reason: `payment ${event.providerRef} captured`,
          });
        } else {
          // Already advanced (client callback or an earlier delivery won the
          // race). Idempotent no-op — payment is captured, nothing else to do.
          this.logger.debug(`order ${event.orderId} already '${order.status}', skip transition`);
        }

        // 3) Mark the webhook event processed.
        await this.db
          .update(schema.paymentWebhookEvents)
          .set({ processedAt: new Date() })
          .where(
            and(
              eq(schema.paymentWebhookEvents.provider, provider),
              eq(schema.paymentWebhookEvents.providerEventId, event.providerEventId),
            ),
          );
      },
      { ttlMs: 15_000, waitMs: 5_000 },
    );
  }

  // ----------------------- helpers -----------------------
  private secretFor(provider: string): string {
    const key = `PAYMENT_WEBHOOK_SECRET_${provider.toUpperCase()}`;
    const secret = process.env[key];
    if (!secret) throw new UnrecoverableError(`No webhook secret configured (${key})`);
    return secret;
  }

  /**
   * Map a provider-specific payload to our normalised shape. Shown Stripe-style;
   * add a branch per provider. orderId is carried in metadata we set at intent
   * creation so we can map the gateway transaction back to our order.
   */
  private normalize(provider: string, rawBody: Buffer): NormalizedEvent {
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, any>;
    const obj = body?.data?.object ?? {};
    return {
      providerEventId: String(body.id),
      eventType: String(body.type ?? 'unknown'),
      orderId: String(obj.metadata?.orderId ?? body.metadata?.orderId ?? ''),
      providerRef: String(obj.id ?? body.id),
      amountCents: Number(obj.amount_received ?? obj.amount ?? 0),
      currency: String(obj.currency ?? 'usd').toUpperCase(),
      succeeded:
        body.type === 'payment_intent.succeeded' ||
        body.type === 'charge.succeeded' ||
        obj.status === 'succeeded',
    };
  }
}
