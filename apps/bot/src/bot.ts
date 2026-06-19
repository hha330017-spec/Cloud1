import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import type { BotContext } from './context';
import { config } from './config';
import { resolveLocale } from './lib/i18n';
import { handleStart } from './handlers/start';
import { handleOrdersList } from './handlers/orders';
import { handleInlineQuery } from './handlers/inline';

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.botToken);

  // --- API transformers (order matters) ---
  // 1) Global flood control: keeps us under Telegram's ~30 msg/s global and
  //    ~1 msg/s per-chat limits BEFORE requests go out (prevents most 429s).
  bot.api.config.use(apiThrottler());
  // 2) Automatic 429 handling: on "429 Too Many Requests" grammY waits exactly
  //    `parameters.retry_after` seconds and retries — no manual backoff needed.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  // --- Middleware: resolve locale dynamically from the user's TG language. ---
  bot.use(async (ctx, next) => {
    ctx.locale = resolveLocale(ctx.from?.language_code);
    await next();
  });

  // --- Routes ---
  bot.command('start', handleStart);
  bot.callbackQuery('orders:list', handleOrdersList);
  bot.on('inline_query', handleInlineQuery);

  bot.catch((err) => {
    console.error('[bot] update', err.ctx?.update.update_id, 'failed:', err.error);
  });

  return bot;
}
