import { Inject, Injectable } from '@nestjs/common';
import type { Usage } from '@frontdesk/shared';
import { AiResolver } from '../ai/ai-resolver.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const currentMonth = () => new Date().toISOString().slice(0, 7); // UTC calendar month

/** The monthly AI spend cap, counted in tokens (input + output). */
@Injectable()
export class UsageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiResolver) private readonly ai: AiResolver,
  ) {}

  async capReached(workspaceId: string): Promise<boolean> {
    const [ws, usage] = await Promise.all([
      this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { monthlyTokenCap: true } }),
      this.prisma.usageMonth.findUnique({ where: { workspaceId_month: { workspaceId, month: currentMonth() } } }),
    ]);
    if (!ws) return true;
    return (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) >= ws.monthlyTokenCap;
  }

  async summary(workspaceId: string): Promise<Usage> {
    const month = currentMonth();
    const since = new Date(`${month}-01T00:00:00Z`);
    const [ws, usage, conversations, enquiries, openUnanswered] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { monthlyTokenCap: true, retentionDays: true, isDemo: true } }),
      this.prisma.usageMonth.findUnique({ where: { workspaceId_month: { workspaceId, month } } }),
      this.prisma.conversation.count({ where: { workspaceId, createdAt: { gte: since }, messages: { some: {} } } }),
      this.prisma.enquiry.count({ where: { workspaceId, createdAt: { gte: since } } }),
      this.prisma.unansweredQuestion.count({ where: { workspaceId, resolvedAt: null } }),
    ]);
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    return {
      month,
      inputTokens,
      outputTokens,
      monthlyTokenCap: ws.monthlyTokenCap,
      mode: inputTokens + outputTokens >= ws.monthlyTokenCap ? 'message' : 'chat',
      conversations,
      enquiries,
      openUnanswered,
      retentionDays: ws.retentionDays,
      ai: await this.ai.source(workspaceId, ws.isDemo),
    };
  }
}
