import { Worker, type Job, UnrecoverableError } from 'bullmq';
import { Redis } from 'ioredis';
import { Api, GrammyError, InlineKeyboard } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import { eq } from 'drizzle-orm';
import { getDb, schema, closeDb } from '@repo/db';
import {
  EVENT,
  type DomainEventEnvelope,
  type OrderStatusChangedPayload,
} from '@repo/types';
import { config } from './config';
import { resolveLocale, t } from './lib/i18n';
import { miniAppDeepLink } from './lib/deeplink';

/**
 * Dedicated Telegram API instance for outbound notifications, hardened the same
 * way as the bot: throttler to stay under rate limits, autoRetry to honour
 * 429 `retry_after` automatically.
 */
const api = new Api(config.botToken);
api.config.use(apiThrottler());
api.config.use(autoRetry({ maxRetryAttempts: 5, maxDelaySeconds: 120 }));

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const db = getDb();

type Channel = 'telegram' | 'web_push' | 'email';

interface NotificationJob {
  template: string;
  event: DomainEventEnvelope;
}

/**
 * Worker for the 'notifications' queue (jobs enqueued by the API's
 * order.status_changed consumer). For each job it:
 *   1. resolves the app user + their preferred channel,
 *   2. resolves locale dynamically,
 *   3. renders the localized template,
 *   4. sends via Telegram with throttle + 429 auto-retry,
 *   5. records the result in the notifications table.
 *
 * Concurrency 10; BullMQ adds job-level exponential backoff as a backstop if the
 * Telegram call ultimately fails after the API-level retries are exhausted.
 */
export const notificationsWorker = new Worker<NotificationJob>(
  'notifications',
  async (job: Job<NotificationJob>) => {
    const { template, event } = job.data;

    // This worker handles order lifecycle events (they carry userId + orderNumber).
    if (
      event.eventType !== EVENT.ORDER_STATUS_CHANGED &&
      event.eventType !== EVENT.ORDER_CREATED
    ) {
      return; // payment.* etc. handled elsewhere
    }

    const payload = event.payload as OrderStatusChangedPayload;
    const userId = payload.userId;
    if (!userId) throw new UnrecoverableError('event missing userId');

    // 1) Resolve user + preferred channel.
    const [user] = await db
      .select({
        telegramId: schema.users.telegramId,
        languageCode: schema.users.languageCode,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) throw new UnrecoverableError(`user ${userId} not found`);

    const channel: Channel | null = pickChannel(user.telegramId);
    if (channel !== 'telegram' || !user.telegramId) {
      // web_push/email handled by other workers; nothing to do here.
      return;
    }

    // 2) + 3) Locale + rendered message.
    const locale = resolveLocale(user.languageCode);
    const text = t(locale, template, { orderNumber: payload.orderNumber });
    const kb = new InlineKeyboard().url(
      t(locale, 'view_order'),
      miniAppDeepLink(`order_${payload.orderId}`),
    );

    // 4) Send (throttled + 429-aware). 5) Record outcome.
    try {
      await api.sendMessage(Number(user.telegramId), text, {
        reply_markup: kb,
        link_preview_options: { is_disabled: true },
      });
      await recordNotification(userId, template, payload, 'sent');
    } catch (err) {
      await handleSendError(err, userId, template, payload);
    }
  },
  { connection, concurrency: 10, limiter: { max: 25, duration: 1000 } },
);

function pickChannel(telegramId: number | null): Channel | null {
  // Preference order: telegram > web_push > email.
  if (telegramId) return 'telegram';
  return 'web_push';
}

async function recordNotification(
  userId: string,
  template: string,
  payload: OrderStatusChangedPayload,
  status: 'sent' | 'failed',
  lastError?: string,
): Promise<void> {
  await db.insert(schema.notifications).values({
    userId,
    channel: 'telegram',
    template,
    payload: { orderId: payload.orderId, orderNumber: payload.orderNumber },
    status,
    ...(status === 'sent' ? { sentAt: new Date() } : {}),
    ...(lastError ? { lastError } : {}),
  });
}

/**
 * Translate Telegram errors into the right retry semantics.
 *
 * Rate limits: the PRIMARY 429 handler is the autoRetry transformer above — it
 * transparently waits `parameters.retry_after` and retries the API call, so a
 * 429 almost never reaches this catch. If retries are exhausted, we rethrow and
 * BullMQ's job-level exponential backoff (configured at enqueue time) becomes
 * the secondary safety net.
 *
 *   - 403 (user blocked bot) / 400 (chat not found) -> UNRECOVERABLE, no retry.
 *   - everything else (429-exhausted, 5xx, network) -> rethrow for BullMQ backoff.
 */
async function handleSendError(
  err: unknown,
  userId: string,
  template: string,
  payload: OrderStatusChangedPayload,
): Promise<never> {
  if (err instanceof GrammyError) {
    await recordNotification(userId, template, payload, 'failed', err.description);
    if (err.error_code === 403 || err.error_code === 400) {
      throw new UnrecoverableError(`telegram ${err.error_code}: ${err.description}`);
    }
    throw err; // 429-exhausted / 5xx -> BullMQ retries with backoff
  }
  await recordNotification(userId, template, payload, 'failed', String(err));
  throw err instanceof Error ? err : new Error(String(err));
}

notificationsWorker.on('failed', (job, err) => {
  console.error(`[worker] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});

async function shutdown(): Promise<void> {
  await notificationsWorker.close();
  await connection.quit();
  await closeDb();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

console.log('[worker] notifications worker started');
