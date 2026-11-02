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
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { ConversationsService } from '../handover/conversations.service.js';
import { UsageService } from '../insights/usage.service.js';
import { AiResolver } from '../ai/ai-resolver.js';
import { findReplay } from '../demo/replay.js';
import { type ReplyResult, AssistantService, FALLBACK_ERROR } from './assistant.service.js';
import { conversationRoom, RealtimeService } from './realtime.service.js';
import { clientIp } from './client-ip.js';
import { toChatMessage, WidgetService } from './widget.service.js';

interface VisitorData {
  workspaceId: string;
  isDemo: boolean;
  conversationId: string;
  visitorId: string;
  ip: string;
}

export const NO_PROVIDER_NOTE =
  'No AI provider is configured yet, so the assistant can’t answer. You can leave a message or ask for a person.';
export const REPLAY_ONLY_NOTE =
  'This demo answers the suggested questions with sample answers. To ask anything else, add your own AI key in the chat.';
/** Shown on every replayed answer. */
export const DEMO_LABEL = 'Demo: sample answer';

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
    @Inject(AiResolver) private readonly ai: AiResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
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
        isDemo: info.isDemo,
        conversationId: claims.cid,
        visitorId: claims.vid,
        ip: clientIp(socket.handshake.address, socket.handshake.headers['x-forwarded-for'], this.config.TRUST_PROXY === 'private'),
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

      // While a person has the chat, the assistant stays quiet.
      if (conversation.mode === 'ai') await this.respond(data, conversation.id, parsed.data.text);
      await this.conversations.broadcast(data.workspaceId, conversation.id);
      return { ok: true };
    } finally {
      await this.redis.client.del(lock);
    }
  }

  /** No provider: say so. Demo without a visitor key: replay. Over the monthly cap: leave-a-message only. */
  private async respond(data: VisitorData, conversationId: string, question: string): Promise<void> {
    const ai = await this.ai.forChat(data.workspaceId, data.isDemo, conversationId);
    if (ai.kind === 'none') {
      await this.conversations.system(data.workspaceId, conversationId, NO_PROVIDER_NOTE);
      return;
    }
    if (ai.kind === 'replay') {
      if (!findReplay(question)) await this.conversations.system(data.workspaceId, conversationId, REPLAY_ONLY_NOTE);
      else await this.answer(data, DEMO_LABEL, (onText) => this.assistant.replay(data.workspaceId, conversationId, question, onText));
      return;
    }
    if (await this.usage.capReached(data.workspaceId)) {
      await this.conversations.system(
        data.workspaceId,
        conversationId,
        'Our assistant isn’t available right now. Please leave a message and the team will get back to you.',
      );
      this.realtime.toVisitor(conversationId, 'handover:unavailable');
      return;
    }
    await this.answer(data, null, (onText) => this.assistant.reply(data.workspaceId, conversationId, question, onText, ai.provider));
  }

  /** Streams one reply and saves it. */
  private async answer(
    data: VisitorData,
    authorName: string | null,
    produce: (onText: (t: string) => void) => Promise<ReplyResult | null>,
  ): Promise<void> {
    const room = this.ns.to(conversationRoom(data.conversationId));
    const tempId = `pending-${Date.now()}`;
    room.emit('reply:start', { id: tempId });
    const result = (await produce((text) => room.emit('reply:delta', { id: tempId, text }))) ?? {
      text: FALLBACK_ERROR,
      sources: [],
      unanswered: false,
      inputTokens: 0,
      outputTokens: 0,
      failed: true,
    };
    const saved = await this.prisma.message.create({
      data: {
        conversationId: data.conversationId,
        workspaceId: data.workspaceId,
        role: 'assistant',
        authorName,
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
    if (data.isDemo) {
      // The public demo: a strict daily allowance per visitor and per IP.
      checks.push([`demo:visitor:${data.visitorId}`, 20, 24 * 60 * 60], [`demo:ip:${data.ip}`, 60, 24 * 60 * 60]);
    }
    for (const [key, limit, window] of checks) {
      const wait = await this.limiter.check(key, limit, window);
      if (wait !== null) return `You’re sending messages too quickly. Please try again in ${wait} seconds.`;
    }
    return null;
  }
}
