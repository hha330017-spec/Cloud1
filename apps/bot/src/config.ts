function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  botToken: required('TELEGRAM_BOT_TOKEN'),
  /** Public bot username (no @) used to build deep links: t.me/<username>/shop */
  botUsername: required('TELEGRAM_BOT_USERNAME'),
  /** Short name of the Mini App configured in BotFather (e.g. "shop"). */
  miniAppShortName: process.env.TELEGRAM_MINIAPP_SHORTNAME ?? 'shop',
  /** Direct Mini App URL for web_app keyboard buttons. */
  miniAppUrl: required('TELEGRAM_MINIAPP_URL'),
  apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000/v1',
  redisUrl: required('REDIS_URL'),
  databaseUrl: required('DATABASE_URL'),
  defaultLocale: process.env.DEFAULT_LOCALE ?? 'en',
} as const;
