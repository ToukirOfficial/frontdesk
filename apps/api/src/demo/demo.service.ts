import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { AiResolver } from '../ai/ai-resolver.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KNOWLEDGE_QUEUE, type KnowledgeJob } from '../queues.js';
import { RedisService } from '../redis/redis.service.js';
import { widgetCacheKey } from '../chat/widget.service.js';
import { assistantContextKey } from '../business/business.service.js';
import { DEMO_BUSINESS, DEMO_FAQS, DEMO_GREETING, DEMO_PAGES, DEMO_RULES } from './clinic.js';

/** The public demo's fictional clinic: created if missing, reset every night (DEMO_MODE only). */
@Injectable()
export class DemoService {
  private readonly log = new Logger('Demo');

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @InjectQueue(KNOWLEDGE_QUEUE) private readonly queue: Queue<KnowledgeJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AiResolver) private readonly ai: AiResolver,
  ) {}

  /** Idempotent: settings are put back to the demo values; knowledge is added only if the clinic has none. */
  async seed(): Promise<string> {
    const existing = await this.prisma.workspace.findFirst({ where: { isDemo: true }, orderBy: { createdAt: 'asc' } });
    const ws =
      existing ??
      (await this.prisma.workspace.create({
        data: { name: DEMO_BUSINESS.name, isDemo: true, monthlyTokenCap: this.config.DEMO_MONTHLY_TOKEN_CAP, retentionDays: 7 },
      }));
    await this.prisma.workspace.update({
      where: { id: ws.id },
      data: { name: DEMO_BUSINESS.name, monthlyTokenCap: this.config.DEMO_MONTHLY_TOKEN_CAP, retentionDays: 7, allowedOrigins: [] },
    });
    await this.prisma.businessProfile.upsert({
      where: { workspaceId: ws.id },
      create: { workspaceId: ws.id, ...DEMO_BUSINESS },
      update: DEMO_BUSINESS,
    });
    const assistant = { preset: 'clinic' as const, rules: DEMO_RULES, greeting: DEMO_GREETING, brandColour: '#0f766e', position: 'right' };
    await this.prisma.assistantSettings.upsert({
      where: { workspaceId: ws.id },
      create: { workspaceId: ws.id, ...assistant },
      update: { ...assistant, slotwiseBaseUrl: null, slotwiseKeyCipher: null, avatarName: null },
    });

    if ((await this.prisma.knowledgeSource.count({ where: { workspaceId: ws.id } })) === 0) {
      const rows = await this.prisma.$transaction([
        ...DEMO_FAQS.map((f) =>
          this.prisma.knowledgeSource.create({ data: { workspaceId: ws.id, type: 'faq', title: f.question, question: f.question, content: f.answer } }),
        ),
        ...DEMO_PAGES.map((p) => this.prisma.knowledgeSource.create({ data: { workspaceId: ws.id, type: 'text', title: p.title, content: p.content } })),
      ]);
      for (const r of rows) {
        await this.queue.add('process', { workspaceId: ws.id, sourceId: r.id }, { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true });
      }
    }
    await this.redis.del(widgetCacheKey(ws.publicKey));
    await this.redis.del(assistantContextKey(ws.id));
    return ws.id;
  }

  /**
   * Nightly: every visitor conversation, enquiry and unanswered question in the demo goes, and every visitor's own
   * key with them (they expire after 24 hours anyway); settings are restored.
   */
  async reset(): Promise<void> {
    const ws = await this.prisma.workspace.findFirst({ where: { isDemo: true } });
    if (ws) {
      await this.prisma.$transaction([
        this.prisma.conversation.deleteMany({ where: { workspaceId: ws.id } }),
        this.prisma.enquiry.deleteMany({ where: { workspaceId: ws.id } }),
        this.prisma.unansweredQuestion.deleteMany({ where: { workspaceId: ws.id } }),
      ]);
      await this.prisma.aiSettings.deleteMany({ where: { workspaceId: ws.id } });
    }
    await this.ai.deleteAllDemoKeys();
    await this.seed();
    this.log.log('Demo reset');
  }

  async publicKey(): Promise<string | null> {
    const ws = await this.prisma.workspace.findFirst({ where: { isDemo: true }, select: { publicKey: true }, orderBy: { createdAt: 'asc' } });
    return ws?.publicKey ?? null;
  }
}
