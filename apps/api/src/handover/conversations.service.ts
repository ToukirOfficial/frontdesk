import { Inject, Injectable } from '@nestjs/common';
import { type ConversationDetail, type ConversationList, type ConversationSummary, ErrorCode } from '@frontdesk/shared';
import type { WorkspaceAuth } from '../common/auth.js';
import { AppError, notFound } from '../common/errors.js';
import { RealtimeService } from '../chat/realtime.service.js';
import { toChatMessage } from '../chat/widget.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Conversation } from '../generated/prisma/client.js';

const PAGE = 30;

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  /** Newest activity first, optionally only those with a message containing `q`. `cursor` = last id of the previous page. */
  async list(auth: WorkspaceAuth, cursor?: string, q?: string): Promise<ConversationList> {
    const search = q?.trim();
    const rows = await this.prisma.conversation.findMany({
      where: {
        workspaceId: auth.workspaceId,
        messages: search
          ? { some: { workspaceId: auth.workspaceId, content: { contains: search, mode: 'insensitive' } } }
          : { some: {} },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, PAGE);
    return { items: await Promise.all(page.map((c) => this.summary(c))), nextCursor: rows.length > PAGE ? (page.at(-1)?.id ?? null) : null };
  }

  async detail(auth: WorkspaceAuth, conversationId: string): Promise<ConversationDetail> {
    const c = await this.find(auth, conversationId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: c.id, workspaceId: auth.workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return { ...(await this.summary(c)), messages: messages.map(toChatMessage) };
  }

  /**
   * Atomic: one conditional update, so of two people pressing "Take over" at once exactly one wins and the other
   * gets 409.
   */
  async takeover(auth: WorkspaceAuth, conversationId: string): Promise<ConversationSummary> {
    await this.find(auth, conversationId);
    const { count } = await this.prisma.conversation.updateMany({
      where: { id: conversationId, workspaceId: auth.workspaceId, mode: 'ai' },
      data: { mode: 'human', assignedUserId: auth.userId, handoverRequestedAt: null },
    });
    if (count === 0) throw new AppError(409, ErrorCode.ALREADY_TAKEN, 'Someone else is already handling this chat.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { name: true } });
    await this.system(auth.workspaceId, conversationId, `You’re now chatting with ${user.name}.`);
    this.realtime.toVisitor(conversationId, 'mode', { mode: 'human', staffName: user.name });
    return this.broadcast(auth.workspaceId, conversationId);
  }

  /** The person handling the chat (or an owner or admin) hands it back to the assistant. */
  async handback(auth: WorkspaceAuth, conversationId: string): Promise<ConversationSummary> {
    const c = await this.find(auth, conversationId);
    const manager = auth.role === 'owner' || auth.role === 'admin';
    const { count } = await this.prisma.conversation.updateMany({
      where: {
        id: c.id,
        workspaceId: auth.workspaceId,
        mode: 'human',
        ...(manager ? {} : { assignedUserId: auth.userId }),
      },
      data: { mode: 'ai', assignedUserId: null },
    });
    if (count === 0) throw new AppError(409, ErrorCode.NOT_ASSIGNED, 'This chat isn’t yours to hand back.');
    await this.system(auth.workspaceId, conversationId, 'You’re chatting with the assistant again.');
    this.realtime.toVisitor(conversationId, 'mode', { mode: 'ai', staffName: null });
    return this.broadcast(auth.workspaceId, conversationId);
  }

  /** Only the person who took the chat over can write in it. */
  async reply(auth: WorkspaceAuth, conversationId: string, text: string) {
    const c = await this.find(auth, conversationId);
    if (c.mode !== 'human' || c.assignedUserId !== auth.userId) {
      throw new AppError(409, ErrorCode.NOT_ASSIGNED, 'Take over the chat before replying.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { name: true } });
    const msg = await this.prisma.message.create({
      data: { conversationId: c.id, workspaceId: auth.workspaceId, role: 'staff', content: text, authorName: user.name },
    });
    await this.prisma.conversation.update({ where: { id: c.id }, data: { lastMessageAt: new Date() } });
    const dto = toChatMessage(msg);
    this.realtime.toVisitor(c.id, 'message', dto);
    this.realtime.staffMessage(auth.workspaceId, c.id, dto);
    await this.broadcast(auth.workspaceId, c.id);
    return dto;
  }

  async summary(c: Conversation): Promise<ConversationSummary> {
    const [last, count, assigned] = await Promise.all([
      this.prisma.message.findFirst({
        where: { conversationId: c.id, workspaceId: c.workspaceId, role: { in: ['visitor', 'assistant', 'staff'] } },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      }),
      this.prisma.message.count({ where: { conversationId: c.id, workspaceId: c.workspaceId } }),
      c.assignedUserId ? this.prisma.user.findUnique({ where: { id: c.assignedUserId }, select: { name: true } }) : null,
    ]);
    return {
      id: c.id,
      mode: c.mode,
      assignedUserId: c.assignedUserId,
      assignedName: assigned?.name ?? null,
      handoverRequested: c.handoverRequestedAt !== null,
      lastMessage: last ? last.content.slice(0, 140) : null,
      lastMessageAt: c.lastMessageAt.toISOString(),
      messageCount: count,
    };
  }

  /** Sends the conversation's current summary to the workspace's staff dashboards and returns it. */
  async broadcast(workspaceId: string, conversationId: string, event: 'conversation' | 'handover:requested' = 'conversation') {
    const c = await this.prisma.conversation.findFirstOrThrow({ where: { id: conversationId, workspaceId } });
    const s = await this.summary(c);
    this.realtime.staffConversation(workspaceId, s, event);
    return s;
  }

  /** A note in the conversation shown to both sides ("You're now chatting with…"). */
  async system(workspaceId: string, conversationId: string, text: string): Promise<void> {
    const msg = await this.prisma.message.create({ data: { conversationId, workspaceId, role: 'system', content: text } });
    const dto = toChatMessage(msg);
    this.realtime.toVisitor(conversationId, 'message', dto);
    this.realtime.staffMessage(workspaceId, conversationId, dto);
  }

  private async find(auth: WorkspaceAuth, conversationId: string): Promise<Conversation> {
    const c = await this.prisma.conversation.findFirst({ where: { id: conversationId, workspaceId: auth.workspaceId } });
    if (!c) throw notFound('Conversation not found.');
    return c;
  }
}
