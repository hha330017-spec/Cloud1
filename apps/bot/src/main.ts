import { run, type RunnerHandle } from '@grammyjs/runner';
import { createBot } from './bot';

/**
 * Concurrent long-polling via @grammyjs/runner.
 *
 * The runner pulls updates and dispatches them CONCURRENTLY (unlike bot.start(),
 * which is sequential), so a slow handler for one user never blocks others.
 * Per-chat ordering is preserved by the runner's sequentialization key.
 *
 * In production behind a public HTTPS endpoint, prefer webhooks
 * (bot.api.setWebhook + webhookCallback) with the X-Telegram-Bot-Api-Secret-Token
 * header validated by the API; long-polling here is ideal for workers/dev.
 */
async function main(): Promise<void> {
  const bot = createBot();
  await bot.init(); // fetch bot info up front (needed for inline @username etc.)

  const runner: RunnerHandle = run(bot, {
    runner: {
      fetch: { allowed_updates: ['message', 'callback_query', 'inline_query'] },
    },
  });

  console.log(`[bot] @${bot.botInfo.username} running (concurrent)`);

  const stop = async () => {
    console.log('[bot] shutting down...');
    if (runner.isRunning()) await runner.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main();
