import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS } from '../redis/redis.module';

/**
 * Distributed mutex (single-node Redlock-lite). Used to serialise processing of
 * a given order across replicas, e.g. a webhook delivered twice (to two pods)
 * plus a client-side confirmation all racing to "mark paid". The token makes
 * release safe: we only delete the key if WE still own it (prevents releasing a
 * lock that already expired and was re-acquired by someone else).
 */
@Injectable()
export class RedisLock {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async acquire(key: string, ttlMs = 10_000): Promise<string | null> {
    const token = randomUUID();
    const ok = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    // Atomic check-and-delete so we never release another owner's lock.
    const lua =
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
    await this.redis.eval(lua, 1, key, token);
  }

  /** Acquire with bounded retries, run fn, always release. */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    opts: { ttlMs?: number; waitMs?: number; retryMs?: number } = {},
  ): Promise<T> {
    const { ttlMs = 10_000, waitMs = 3_000, retryMs = 100 } = opts;
    const deadline = Date.now() + waitMs;
    let token: string | null = null;

    while (!(token = await this.acquire(key, ttlMs))) {
      if (Date.now() > deadline) {
        throw new Error(`Could not acquire lock ${key} within ${waitMs}ms`);
      }
      await new Promise((r) => setTimeout(r, retryMs));
    }

    try {
      return await fn();
    } finally {
      await this.release(key, token);
    }
  }
}
