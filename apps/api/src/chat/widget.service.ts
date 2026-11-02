import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { type ChatMessage, ErrorCode, type SourceRef, sourceRefSchema, type WidgetConfig } from '@frontdesk/shared';
import { z } from 'zod';
import { VISITOR_AUDIENCE } from '../auth/sessions.service.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { Message } from '../generated/prisma/client.js';

const VISITOR_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;

/** What the widget routes and the gateway need about a workspace, cached briefly in Redis. */
export interface WidgetInfo {
  workspaceId: string;
  publicKey: string;
  name: string;
  greeting: string;
  brandColour: string;
  position: 'left' | 'right';
  hasAvatar: boolean;
  allowedOrigins: string[];
}

export interface VisitorClaims {
  wid: string;
  cid: string;
  vid: string;
}

export const widgetCacheKey = (publicKey: string) => `widget:${publicKey}`;

const sourcesOf = (raw: unknown): SourceRef[] => {
  const parsed = z.array(sourceRefSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
};

export const toChatMessage = (m: Message): ChatMessage => ({
  id: m.id,
  role: m.role,
  content: m.content,
  authorName: m.authorName,
  sources: sourcesOf(m.sources),
  createdAt: m.createdAt.toISOString(),
});

@Injectable()
export class WidgetService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  async byKey(publicKey: string): Promise<WidgetInfo> {
    const cached = await this.redis.getJson<WidgetInfo>(widgetCacheKey(publicKey));
    if (cached) return cached;
    const ws = await this.prisma.workspace.findUnique({
      where: { publicKey },
      include: { business: { select: { name: true } }, assistant: true },
    });
    if (!ws) throw notFound('Unknown widget key.');
    const info: WidgetInfo = {
      workspaceId: ws.id,
      publicKey: ws.publicKey,
      name: ws.business?.name || ws.name,
      greeting: ws.assistant?.greeting ?? 'Hello! How can I help you today?',
      brandColour: ws.assistant?.brandColour ?? '#0f766e',
      position: ws.assistant?.position === 'left' ? 'left' : 'right',
      hasAvatar: Boolean(ws.assistant?.avatarName),
      allowedOrigins: ws.allowedOrigins,
    };
    await this.redis.setJson(widgetCacheKey(publicKey), info, 60);
    return info;
  }

  /**
   * Browsers send Origin; if the workspace lists allowed sites, it must be one of them. Requests without an Origin
   * (scripts, curl) pass this check: origin checks only stop other websites, which is why rate limits also apply.
   */
  checkOrigin(info: WidgetInfo, origin: string | undefined): void {
    if (!origin || info.allowedOrigins.length === 0) return;
    if (!info.allowedOrigins.includes(origin)) {
      throw new AppError(403, ErrorCode.FORBIDDEN, 'This website isn’t allowed to use this chat.');
    }
  }

  /** avatarUrl is relative to the Frontdesk server; the widget resolves it against the address it loaded from. */
  config(info: WidgetInfo, mode: WidgetConfig['mode']): WidgetConfig {
    return {
      name: info.name,
      greeting: info.greeting,
      brandColour: info.brandColour,
      position: info.position,
      avatarUrl: info.hasAvatar ? `/api/widget/${info.publicKey}/avatar` : null,
      mode,
    };
  }

  /** Resumes the visitor's conversation if their token is valid for THIS workspace, otherwise starts a new one. */
  async session(info: WidgetInfo, token: string | undefined): Promise<{ token: string; conversationId: string; messages: ChatMessage[] }> {
    const claims = token ? await this.verify(token) : null;
    let conversation =
      claims && claims.wid === info.workspaceId
        ? await this.prisma.conversation.findFirst({ where: { id: claims.cid, workspaceId: info.workspaceId } })
        : null;
    if (!conversation || conversation.mode === 'closed') {
      conversation = await this.prisma.conversation.create({
        data: { workspaceId: info.workspaceId, visitorId: claims?.wid === info.workspaceId ? claims.vid : randomUUID() },
      });
    }
    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id, workspaceId: info.workspaceId, role: { not: 'system' } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const fresh: VisitorClaims = { wid: info.workspaceId, cid: conversation.id, vid: conversation.visitorId };
    return {
      token: await this.jwt.signAsync(fresh, { audience: VISITOR_AUDIENCE, expiresIn: VISITOR_TOKEN_TTL_SEC }),
      conversationId: conversation.id,
      messages: messages.map(toChatMessage),
    };
  }

  async verify(token: string): Promise<VisitorClaims | null> {
    try {
      const c = await this.jwt.verifyAsync<VisitorClaims>(token, { audience: VISITOR_AUDIENCE });
      return typeof c.wid === 'string' && typeof c.cid === 'string' && typeof c.vid === 'string' ? c : null;
    } catch {
      return null;
    }
  }
}
