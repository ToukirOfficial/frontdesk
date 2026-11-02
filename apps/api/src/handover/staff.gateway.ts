import { Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { type AccessPayload, DASHBOARD_AUDIENCE } from '../auth/sessions.service.js';
import { Public } from '../common/auth.js';
import { ACCESS_COOKIE, readCookie } from '../common/cookies.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService, staffRoom } from '../chat/realtime.service.js';

const joinSchema = z.object({ workspaceId: z.uuid() });

/**
 * Live updates for the conversations dashboard. Authenticated on connect with the dashboard's access cookie; a
 * request from any other site's origin is refused (so another site can't open a socket with someone's cookie). A socket joins one
 * workspace's room at a time, after a membership check.
 */
@Public() // authenticated per socket in handleConnection, with the access cookie
@WebSocketGateway({ namespace: '/staff' })
export class StaffGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  afterInit(ns: Namespace): void {
    this.realtime.setStaffNamespace(ns);
  }

  async handleConnection(socket: Socket): Promise<void> {
    try {
      // Browsers always send Origin cross-site (WebSocket handshakes, cross-origin requests) but not on same-origin
      // GETs such as Socket.IO's first polling request. So: refuse any other origin; a missing one is same-origin
      // or not a browser, and still needs the httpOnly cookie.
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== new URL(this.config.WEB_URL).origin) throw new Error('origin');
      const token = readCookie({ headers: socket.handshake.headers }, ACCESS_COOKIE);
      if (!token) throw new Error('no cookie');
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, { audience: DASHBOARD_AUDIENCE });
      socket.data = { userId: payload.sub, workspaceId: null as string | null };
      // A socket lives no longer than the login that opened it; the dashboard refreshes and reconnects.
      const left = payload.exp ? payload.exp * 1000 - Date.now() : 0;
      const timer = setTimeout(() => socket.disconnect(true), Math.max(0, left));
      socket.once('disconnect', () => clearTimeout(timer));
    } catch {
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<{ ok: boolean }> {
    const data = socket.data as { userId?: string; workspaceId: string | null } | undefined;
    const parsed = joinSchema.safeParse(body);
    if (!data?.userId || !parsed.success) return { ok: false };
    const member = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: parsed.data.workspaceId, userId: data.userId } },
      select: { id: true },
    });
    if (!member) return { ok: false };
    if (data.workspaceId) await socket.leave(staffRoom(data.workspaceId));
    data.workspaceId = parsed.data.workspaceId;
    await socket.join(staffRoom(parsed.data.workspaceId));
    return { ok: true };
  }
}
