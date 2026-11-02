import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode, type Role } from '@frontdesk/shared';
import { type AuthedRequest, IS_PUBLIC, LOGGED_IN, ROLES } from '../common/auth.js';
import { ACCESS_COOKIE, readCookie } from '../common/cookies.js';
import { AppError, forbidden, notFound, unauthenticated } from '../common/errors.js';
import { UUID_RE } from '../common/ids.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessPayload } from './sessions.service.js';

/**
 * Global guard, deny by default. A route is reachable only if it says @Public(), @LoggedIn() or @Roles(...).
 * For @Roles routes the guard checks that the user is a member of the `:workspaceId` in the URL with one of the
 * roles. Not a member → 404 (another workspace's id reveals nothing). Ownership of rows inside the workspace is
 * checked in the services, which always filter by the workspaceId set here.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return false; // WebSocket gateways authenticate on connect
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    const loggedIn = this.reflector.getAllAndOverride<boolean>(LOGGED_IN, targets);
    if (!roles?.length && !loggedIn) throw forbidden(); // a route that forgot to say who may call it is closed

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const userId = await this.userIdFrom(req);

    if (!roles?.length) {
      req.auth = { userId };
      return true;
    }

    const workspaceId = req.params.workspaceId;
    if (typeof workspaceId !== 'string' || !UUID_RE.test(workspaceId)) throw notFound('Workspace not found.');
    const membership = await this.prisma.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    });
    if (!membership) throw notFound('Workspace not found.');
    if (!roles.includes(membership.role)) throw forbidden();
    req.auth = { userId, workspaceId, role: membership.role };
    return true;
  }

  private async userIdFrom(req: AuthedRequest): Promise<string> {
    const token = readCookie(req, ACCESS_COOKIE);
    if (!token) throw unauthenticated();
    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token);
      return payload.sub;
    } catch {
      throw new AppError(401, ErrorCode.SESSION_EXPIRED, 'Your session has expired.');
    }
  }
}
