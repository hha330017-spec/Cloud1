import { Global, Module, type OnModuleDestroy, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');
export const REDIS_SUB = Symbol('REDIS_SUB');

/**
 * Two connections: one general-purpose (commands/cache), one dedicated to
 * subscribe mode. A Redis connection in subscriber mode cannot issue other
 * commands, so the relay/gateway need a separate subscriber.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    },
    {
      provide: REDIS_SUB,
      useFactory: () =>
        new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    },
  ],
  exports: [REDIS, REDIS_SUB],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDIS_SUB) private readonly sub: Redis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    await this.sub.quit();
  }
}
