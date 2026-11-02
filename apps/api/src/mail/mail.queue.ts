import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { EMAIL_QUEUE } from '../queues.js';
import { type MailTemplate, render } from './templates.js';

export interface EmailJob {
  to: string;
  subject: string;
  text: string;
}

/** Emails are never sent inside a request: they are queued and the worker sends them. */
@Injectable()
export class MailQueue {
  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async send(to: string, template: MailTemplate): Promise<void> {
    const rendered = render(template, this.config);
    // Subjects carry names typed by visitors and admins: one line only, so nothing can pose as an extra mail header.
    const subject = rendered.subject.replace(/[\r\n\t]+/g, ' ').slice(0, 200);
    await this.queue.add(
      'send',
      { to, subject, text: rendered.text },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        // Jobs hold codes and links: keep them only as long as needed.
        removeOnComplete: true,
        removeOnFail: { age: 24 * 3600 },
      },
    );
  }
}
