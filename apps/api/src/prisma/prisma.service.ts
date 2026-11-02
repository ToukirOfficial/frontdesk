import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // UTC session so timestamps never shift with the server's time zone.
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL, max: 10, options: '-c TimeZone=UTC' }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** Interactive transaction client type. */
export type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
