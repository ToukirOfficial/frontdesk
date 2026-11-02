import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@frontdesk/shared';
import { RedisService } from '../redis/redis.service.js';
import { AppError } from './errors.js';

/** INCR and set the window's expiry on the first hit, atomically. Returns [count, ttlSeconds]. */
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('TTL', KEYS[1])}
`;

/**
 * Fixed-window limits on named keys (e.g. `login:ip:1.2.3.4`), stored in Redis so they hold across several API
 * instances.
 */
@Injectable()
export class RateLimiter {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  /** Counts one hit; throws 429 with Retry-After once more than `limit` hits land inside `windowSec`. */
  async hit(key: string, limit: number, windowSec: number, message?: string): Promise<void> {
    const retryAfter = await this.check(key, limit, windowSec);
    if (retryAfter !== null) {
      throw new AppError(
        429,
        ErrorCode.RATE_LIMITED,
        message ?? `Too many requests. Try again in ${retryAfter} seconds.`,
        undefined,
        { 'Retry-After': String(retryAfter) },
      );
    }
  }

  /** Counts one hit; returns null if allowed, or the seconds until the window resets. */
  async check(key: string, limit: number, windowSec: number): Promise<number | null> {
    const [count, ttl] = (await this.redis.client.eval(HIT_SCRIPT, 1, `rl:${key}`, windowSec)) as [number, number];
    return count > limit ? Math.max(1, ttl) : null;
  }
}
