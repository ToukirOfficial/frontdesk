import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DemoService } from '../demo/demo.service.js';
import { MAINTENANCE_QUEUE } from '../queues.js';
import { RetentionService } from './retention.service.js';

/** Nightly housekeeping, scheduled once in Redis however many workers run. */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    @Inject(RetentionService) private readonly retention: RetentionService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    @Inject(DemoService) private readonly demo: DemoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler('nightly-retention', { pattern: '15 3 * * *', tz: 'Europe/London' }, { name: 'retention' });
    if (this.config.DEMO_MODE) {
      await this.demo.seed(); // so `docker compose up` with DEMO_MODE=true has a clinic to chat with
      await this.queue.upsertJobScheduler('nightly-demo-reset', { pattern: '30 3 * * *', tz: 'Europe/London' }, { name: 'demo-reset' });
    } else {
      await this.queue.removeJobScheduler('nightly-demo-reset');
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'retention') await this.retention.run();
    if (job.name === 'demo-reset' && this.config.DEMO_MODE) await this.demo.reset();
  }
}
