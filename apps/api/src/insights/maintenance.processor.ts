import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { MAINTENANCE_QUEUE } from '../queues.js';
import { RetentionService } from './retention.service.js';

/** Nightly housekeeping, scheduled once in Redis however many workers run. */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    @Inject(RetentionService) private readonly retention: RetentionService,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler('nightly-retention', { pattern: '15 3 * * *', tz: 'Europe/London' }, { name: 'retention' });
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'retention') await this.retention.run();
  }
}
