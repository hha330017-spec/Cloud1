export interface AppConfig {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  jwt: { accessSecret: string; refreshSecret: string; accessTtl: number; refreshTtl: number };
  telegram: { botToken: string; webhookSecret: string };
  corsOrigins: string[];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function loadConfig(): AppConfig {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.API_PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    redisUrl: required('REDIS_URL'),
    jwt: {
      accessSecret: required('JWT_ACCESS_SECRET'),
      refreshSecret: required('JWT_REFRESH_SECRET'),
      accessTtl: Number(process.env.JWT_ACCESS_TTL ?? 900),
      refreshTtl: Number(process.env.JWT_REFRESH_TTL ?? 2_592_000),
    },
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
    },
    corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  };
}
