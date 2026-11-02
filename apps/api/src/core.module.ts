import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiResolver } from './ai/ai-resolver.js';
import { RealtimeService } from './chat/realtime.service.js';
import { RateLimiter } from './common/rate-limit.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { MailQueue } from './mail/mail.queue.js';
import { PrismaService } from './prisma/prisma.service.js';
import { EMAIL_QUEUE, KNOWLEDGE_QUEUE, MAINTENANCE_QUEUE } from './queues.js';
import { RedisService, redisOptions } from './redis/redis.service.js';

const shared = [PrismaService, RedisService, RateLimiter, MailQueue, AiResolver, RealtimeService];

/** Everything both the API and the worker need: config, database, Redis, queues, which AI provider answers. */
@Global()
@Module({})
export class CoreModule {
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        BullModule.forRoot({
          connection: { ...redisOptions(config.REDIS_URL), maxRetriesPerRequest: null },
          prefix: `${config.REDIS_PREFIX}:bull`,
        }),
        BullModule.registerQueue({ name: EMAIL_QUEUE }, { name: KNOWLEDGE_QUEUE }, { name: MAINTENANCE_QUEUE }),
        JwtModule.register({
          secret: config.JWT_SECRET,
          signOptions: { algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        }),
      ],
      providers: [{ provide: APP_CONFIG, useValue: config }, ...shared],
      exports: [APP_CONFIG, BullModule, JwtModule, ...shared],
    };
  }
}
