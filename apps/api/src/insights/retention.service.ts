import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Deletes visitor data older than each workspace's retention period (default 90 days): conversations (and their
 * messages), enquiries and unanswered questions. Also clears expired login codes, refresh tokens, reset links and
 * invites. Runs nightly in the worker.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger('Retention');

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async run(now = new Date()): Promise<{ conversations: number; enquiries: number; unanswered: number }> {
    const totals = { conversations: 0, enquiries: 0, unanswered: 0 };
    const workspaces = await this.prisma.workspace.findMany({ select: { id: true, retentionDays: true } });
    for (const ws of workspaces) {
      const before = new Date(now.getTime() - ws.retentionDays * 86_400_000);
      const [c, e, u] = await this.prisma.$transaction([
        this.prisma.conversation.deleteMany({ where: { workspaceId: ws.id, lastMessageAt: { lt: before } } }),
        this.prisma.enquiry.deleteMany({ where: { workspaceId: ws.id, createdAt: { lt: before } } }),
        this.prisma.unansweredQuestion.deleteMany({ where: { workspaceId: ws.id, createdAt: { lt: before } } }),
      ]);
      totals.conversations += c.count;
      totals.enquiries += e.count;
      totals.unanswered += u.count;
    }
    const dayAgo = new Date(now.getTime() - 86_400_000);
    await this.prisma.$transaction([
      this.prisma.loginCode.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
      this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
      this.prisma.invite.deleteMany({ where: { expiresAt: { lt: dayAgo } } }),
    ]);
    this.log.log(`Deleted ${totals.conversations} conversations, ${totals.enquiries} enquiries, ${totals.unanswered} unanswered questions`);
    return totals;
  }
}
