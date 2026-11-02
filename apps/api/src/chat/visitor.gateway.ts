import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { type Ack, type ChatMessage, type VisitorServerEvents, visitorMessageSchema } from '@frontdesk/shared';
import type { Namespace, Socket } from 'socket.io';
import { Public } from '../common/auth.js';
import { RateLimiter } from '../common/rate-limit.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ConversationsService } from '../handover/conversations.service.js';
import { UsageService } from '../insights/usage.service.js';
import { AssistantService } from './assistant.service.js';
import { conversationRoom, RealtimeService } from './realtime.service.js';
import { clientIp } from './client-ip.js';
import { toChatMessage, WidgetService } from './widget.service.js';

interface VisitorData {
  workspaceId: string;
  conversationId: string;
  visitorId: string;
  ip: string;
}

type VisitorSocket = Socket<Record<string, never>, VisitorServerEvents, Record<string, never>, VisitorData>;

/**
 * The visitor's side of a chat. A socket authenticates once, on connect, with the visitor token from
 * POST /api/widget/:key/session, and can only ever join that token's conversation.
 */
@Public() // authenticated per socket in handleConnection, with the visitor token
@WebSocketGateway({ namespace: '/visitor' })
export class VisitorGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly log = new Logger('VisitorGateway');
  @WebSocketServer() private readonly ns!: Namespace;

  constructor(
    @Inject(WidgetService) private readonly widgets: WidgetService,
    @Inject(AssistantService) private readonly assistant: AssistantService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(UsageService) private readonly usage: UsageService,
  ) {}

  afterInit(ns: Namespace): void {
    this.realtime.setVisitorNamespace(ns);
  }

  async handleConnection(socket: VisitorSocket): Promise<void> {
    try {
      const auth = socket.handshake.auth as { token?: unknown; key?: unknown };
      const claims = typeof auth.token === 'string' ? await this.widgets.verify(auth.token) : null;
      if (!claims || typeof auth.key !== 'string') throw new Error('bad token');
      const info = await this.widgets.byKey(auth.key);
      if (info.workspaceId !== claims.wid) throw new Error('wrong workspace');
      this.widgets.checkOrigin(info, socket.handshake.headers.origin);
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: claims.cid, workspaceId: claims.wid },
        select: { id: true },
      });
      if (!conversation) throw new Error('no conversation');
      socket.data = {
        workspaceId: claims.wid,
        conversationId: claims.cid,
        visitorId: claims.vid,
        ip: clientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for']),
      };
      await socket.join(conversationRoom(claims.cid));
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('message')
  async onMessage(@ConnectedSocket() socket: VisitorSocket, @MessageBody() body: unknown): Promise<Parameters<Ack>[0]> {
    const data = socket.data as VisitorData | undefined;
    if (!data?.conversationId) return { ok: false, error: 'Not connected.' };
    const parsed = visitorMessageSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Messages can be up to 2,000 characters.' };

    const limited = await this.limited(data);
    if (limited) return { ok: false, error: limited };

    // One reply at a time per conversation.
    const lock = `reply-lock:${data.conversationId}`;
    const got = await this.redis.client.set(lock, '1', 'EX', 60, 'NX');
    if (!got) return { ok: false, error: 'Please wait for the reply before sending another message.' };

    try {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: data.conversationId, workspaceId: data.workspaceId },
      });
      if (!conversation || conversation.mode === 'closed') return { ok: false, error: 'This chat has ended. Reload to start a new one.' };

      const visitorMsg = await this.prisma.message.create({
        data: { conversationId: conversation.id, workspaceId: data.workspaceId, role: 'visitor', content: parsed.data.text },
      });
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
      const dto = toChatMessage(visitorMsg);
      this.realtime.toVisitor(conversation.id, 'message', dto);
      this.realtime.staffMessage(data.workspaceId, conversation.id, dto);

      // While a person has the chat, the assistant stays quiet. Over the monthly cap, it's leave-a-message only.
      if (conversation.mode === 'ai') {
        if (await this.usage.capReached(data.workspaceId)) {
          await this.conversations.system(
            data.workspaceId,
            conversation.id,
            'Our assistant isn’t available right now. Please leave a message and the team will get back to you.',
          );
          this.realtime.toVisitor(conversation.id, 'handover:unavailable');
        } else {
          await this.answer(data, parsed.data.text);
        }
      }
      await this.conversations.broadcast(data.workspaceId, conversation.id);
      return { ok: true };
    } finally {
      await this.redis.client.del(lock);
    }
  }

  private async answer(data: VisitorData, question: string): Promise<void> {
    const room = this.ns.to(conversationRoom(data.conversationId));
    const tempId = `pending-${Date.now()}`;
    room.emit('reply:start', { id: tempId });
    const result = await this.assistant.reply(data.workspaceId, data.conversationId, question, (text) =>
      room.emit('reply:delta', { id: tempId, text }),
    );
    const saved = await this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        workspaceId: data.workspaceId,
        role: 'assistant',
        content: result.text,
        sources: result.sources,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      },
    });
    // Only one reply runs per conversation, so the widget swaps its pending bubble for this final message.
    const msg: ChatMessage = toChatMessage(saved);
    room.emit('reply:end', msg);
    this.realtime.staffMessage(data.workspaceId, data.conversationId, msg);
    if (result.failed) this.log.warn(`Reply fallback used in conversation ${data.conversationId}`);
  }

  /**
   * "Talk to a person". If someone from the team is on the dashboard, they're alerted; if not, the visitor is asked
   * to leave a message instead.
   */
  @SubscribeMessage('handover')
  async onHandover(@ConnectedSocket() socket: VisitorSocket): Promise<{ ok: boolean; available?: boolean; error?: string }> {
    const data = socket.data as VisitorData | undefined;
    if (!data?.conversationId) return { ok: false, error: 'Not connected.' };
    const wait = await this.limiter.check(`handover:visitor:${data.visitorId}`, 3, 10 * 60);
    if (wait !== null) return { ok: false, error: 'You’ve already asked. Someone will be with you soon.' };
    const conversation = await this.prisma.conversation.findFirst({ where: { id: data.conversationId, workspaceId: data.workspaceId } });
    if (!conversation) return { ok: false, error: 'Not connected.' };
    if (conversation.mode === 'human') return { ok: true, available: true };

    if (await this.realtime.staffOnline(data.workspaceId)) {
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { handoverRequestedAt: new Date() } });
      await this.conversations.system(data.workspaceId, conversation.id, 'We’ve asked a member of the team to join. Please wait a moment.');
      await this.conversations.broadcast(data.workspaceId, conversation.id, 'handover:requested');
      return { ok: true, available: true };
    }
    await this.conversations.system(
      data.workspaceId,
      conversation.id,
      'No one from the team is available right now. Leave a message and they’ll get back to you.',
    );
    this.realtime.toVisitor(conversation.id, 'handover:unavailable');
    return { ok: true, available: false };
  }

  /** Per visitor, per IP and per workspace. Returns a message if any limit is hit. */
  private async limited(data: VisitorData): Promise<string | null> {
    const checks: [string, number, number][] = [
      [`chat:visitor:${data.visitorId}`, 10, 60],
      [`chat:ip:${data.ip}`, 30, 60],
      [`chat:ws:${data.workspaceId}`, 300, 60],
    ];
    for (const [key, limit, window] of checks) {
      const wait = await this.limiter.check(key, limit, window);
      if (wait !== null) return `You’re sending messages too quickly. Please try again in ${wait} seconds.`;
    }
    return null;
  }
}
