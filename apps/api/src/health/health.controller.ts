import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/auth.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

/** GET /api/health: 200 when PostgreSQL and Redis both answer, otherwise 503. */
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<{ postgres: boolean; redis: boolean }> {
    const [postgres, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      this.redis.client.ping().then(
        (r) => r === 'PONG',
        () => false,
      ),
    ]);
    if (!postgres || !redis) res.status(HttpStatus.SERVICE_UNAVAILABLE);
    return { postgres, redis };
  }
}
