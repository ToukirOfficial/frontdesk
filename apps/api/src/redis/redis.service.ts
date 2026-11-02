import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config.js';

/** redis://user:pass@host:port/db → ioredis options (BullMQ wants options, not a URL). */
export const redisOptions = (url: string) => {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    db: Number(u.pathname.slice(1) || 0),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
  };
};

/** Shared Redis client. Every key it writes starts with `<REDIS_PREFIX>:` (e.g. `frontdesk:`). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis({
      ...redisOptions(config.REDIS_URL),
      keyPrefix: `${config.REDIS_PREFIX}:`,
      maxRetriesPerRequest: 1,
      commandTimeout: 2000,
    });
    this.client.on('error', () => undefined); // reported by /api/health, not as crash noise
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(`cache:${key}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null; // the cache is an optimisation; never fail a request because of it
    }
  }

  async setJson(key: string, value: unknown, ttlSec: number): Promise<void> {
    try {
      await this.client.set(`cache:${key}`, JSON.stringify(value), 'EX', ttlSec);
    } catch {
      /* see getJson */
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(`cache:${key}`);
    } catch {
      /* see getJson */
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
