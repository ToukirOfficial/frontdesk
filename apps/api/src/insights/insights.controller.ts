import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  answerBodySchema,
  enquiryListSchema,
  type EnquiryList,
  type LimitsBody,
  limitsBodySchema,
  pageQuerySchema,
  resolveBodySchema,
  unansweredListSchema,
  type UnansweredList,
  unansweredParamsSchema,
  unansweredQuerySchema,
  unansweredSchema,
  type Usage,
  usageSchema,
  workspaceParamsSchema,
} from '@frontdesk/shared';
import { AnyMember, Member, Roles, type WorkspaceAuth } from '../common/auth.js';
import { notFound } from '../common/errors.js';
import { Returns } from '../common/schema.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { widgetCacheKey } from '../chat/widget.service.js';
import { UsageService } from './usage.service.js';

const PAGE = 50;

const page = <T extends { id: string }>(rows: T[]) => ({
  items: rows.slice(0, PAGE),
  nextCursor: rows.length > PAGE ? (rows[PAGE - 1]?.id ?? null) : null,
});

/** Enquiries, unanswered questions and usage. Every member can read them; owners and admins change things. */
@Controller('workspaces/:workspaceId')
export class InsightsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  @AnyMember()
  @Get('enquiries')
  @Returns(enquiryListSchema)
  async enquiries(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Query({ schema: pageQuerySchema }) q: { cursor?: string },
    @Member() auth: WorkspaceAuth,
  ): Promise<EnquiryList> {
    const rows = await this.prisma.enquiry.findMany({
      where: { workspaceId: auth.workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const p = page(rows);
    return {
      nextCursor: p.nextCursor,
      items: p.items.map((e) => ({
        id: e.id,
        conversationId: e.conversationId,
        name: e.name,
        email: e.email,
        phone: e.phone,
        need: e.need,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  @AnyMember()
  @Get('unanswered')
  @Returns(unansweredListSchema)
  async unanswered(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Query({ schema: unansweredQuerySchema }) q: { cursor?: string; status: 'open' | 'resolved' },
    @Member() auth: WorkspaceAuth,
  ): Promise<UnansweredList> {
    const rows = await this.prisma.unansweredQuestion.findMany({
      where: { workspaceId: auth.workspaceId, resolvedAt: q.status === 'open' ? null : { not: null } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const p = page(rows);
    return { nextCursor: p.nextCursor, items: p.items.map((u) => this.toDto(u)) };
  }

  @Roles('owner', 'admin')
  @Patch('unanswered/:questionId')
  @Returns(unansweredSchema)
  async resolve(
    @Param({ schema: unansweredParamsSchema }) p: { questionId: string },
    @Member() auth: WorkspaceAuth,
    @Body({ schema: resolveBodySchema }) body: { resolved: boolean },
  ) {
    const row = await this.find(auth, p.questionId);
    const updated = await this.prisma.unansweredQuestion.update({
      where: { id: row.id },
      data: { resolvedAt: body.resolved ? new Date() : null },
    });
    return this.toDto(updated);
  }

  /** Turns the question and the owner's answer into an FAQ, so the assistant knows it next time. */
  @Roles('owner', 'admin')
  @Post('unanswered/:questionId/answer')
  @Returns(unansweredSchema)
  async answer(
    @Param({ schema: unansweredParamsSchema }) p: { questionId: string },
    @Member() auth: WorkspaceAuth,
    @Body({ schema: answerBodySchema }) body: { answer: string },
  ) {
    const row = await this.find(auth, p.questionId);
    const question = row.question.length >= 3 ? row.question.slice(0, 500) : `${row.question}?`.padEnd(3, '?');
    await this.knowledge.create(auth, { type: 'faq', question, answer: body.answer });
    const updated = await this.prisma.unansweredQuestion.update({ where: { id: row.id }, data: { resolvedAt: new Date() } });
    return this.toDto(updated);
  }

  @AnyMember()
  @Get('usage')
  @Returns(usageSchema)
  getUsage(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<Usage> {
    return this.usage.summary(auth.workspaceId);
  }

  @Roles('owner', 'admin')
  @Put('limits')
  @Returns(usageSchema)
  async putLimits(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: limitsBodySchema }) body: LimitsBody,
  ): Promise<Usage> {
    const ws = await this.prisma.workspace.update({ where: { id: auth.workspaceId }, data: body, select: { publicKey: true } });
    await this.redis.del(widgetCacheKey(ws.publicKey));
    return this.usage.summary(auth.workspaceId);
  }

  private async find(auth: WorkspaceAuth, id: string) {
    const row = await this.prisma.unansweredQuestion.findFirst({ where: { id, workspaceId: auth.workspaceId } });
    if (!row) throw notFound('Question not found.');
    return row;
  }

  private toDto(u: { id: string; conversationId: string | null; question: string; resolvedAt: Date | null; createdAt: Date }) {
    return {
      id: u.id,
      conversationId: u.conversationId,
      question: u.question,
      resolvedAt: u.resolvedAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
