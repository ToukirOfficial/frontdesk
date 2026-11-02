import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import nodemailer, { type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { EMAIL_QUEUE } from '../queues.js';
import type { EmailJob } from './mail.queue.js';

/**
 * Sends queued emails. With SMTP_URL set, through SMTP. In demo mode, never (no real emails). Locally without
 * SMTP_URL, each email is written to tmp/mail/<job>.eml so you can read your login code. Contents are never logged.
 */
@Processor(EMAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly log = new Logger('Mail');
  private readonly transport: Transporter | null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    this.transport = config.SMTP_URL && !config.DEMO_MODE ? nodemailer.createTransport(config.SMTP_URL) : null;
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { to, subject, text } = job.data;
    if (this.config.DEMO_MODE) {
      this.log.log(`Demo mode: email ${job.id} not sent`);
      return;
    }
    if (this.transport) {
      await this.transport.sendMail({ from: this.config.MAIL_FROM, to, subject, text });
      this.log.log(`Email ${job.id} sent`);
      return;
    }
    const dir = join(process.cwd(), 'tmp', 'mail');
    await mkdir(dir, { recursive: true });
    const eml = `From: ${this.config.MAIL_FROM}\nTo: ${to}\nSubject: ${subject}\nDate: ${new Date().toUTCString()}\n\n${text}\n`;
    await writeFile(join(dir, `${Date.now()}-${job.id}.eml`), eml, { mode: 0o600 });
    this.log.log(`Email ${job.id} written to tmp/mail (no SMTP_URL set)`);
  }
}
