import { Body, Controller, Delete, Get, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  type AcceptInviteBody,
  acceptInviteBodySchema,
  acceptInviteResultSchema,
  createInviteBodySchema,
  type CreateInviteBody,
  type Invite,
  type InviteList,
  inviteListSchema,
  inviteParamsSchema,
  type InvitePreview,
  invitePreviewSchema,
  inviteSchema,
  inviteTokenParamsSchema,
  okSchema,
  workspaceParamsSchema,
} from '@frontdesk/shared';
import type { Request, Response } from 'express';
import { Member, Public, Roles, type WorkspaceAuth } from '../common/auth.js';
import { setAuthCookies } from '../common/cookies.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Returns } from '../common/schema.js';
import { SessionsService } from '../auth/sessions.service.js';
import { InvitesService } from './invites.service.js';

@Controller()
export class InvitesController {
  constructor(
    @Inject(InvitesService) private readonly invites: InvitesService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Roles('owner', 'admin')
  @Get('workspaces/:workspaceId/invites')
  @Returns(inviteListSchema)
  async list(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<InviteList> {
    return { items: await this.invites.list(auth) };
  }

  @Roles('owner', 'admin')
  @Post('workspaces/:workspaceId/invites')
  @Returns(inviteSchema, 201)
  async create(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: createInviteBodySchema }) body: CreateInviteBody,
  ): Promise<Invite> {
    await this.limiter.hit(`invite:ws:${auth.workspaceId}`, 30, 60 * 60);
    return this.invites.create(auth, body);
  }

  @Roles('owner', 'admin')
  @Delete('workspaces/:workspaceId/invites/:inviteId')
  @Returns(okSchema)
  async revoke(@Param({ schema: inviteParamsSchema }) p: { inviteId: string }, @Member() auth: WorkspaceAuth) {
    await this.invites.revoke(auth, p.inviteId);
    return { ok: true } as const;
  }

  @Public()
  @Get('invites/:token')
  @Returns(invitePreviewSchema)
  async preview(@Param({ schema: inviteTokenParamsSchema }) p: { token: string }, @Req() req: Request): Promise<InvitePreview> {
    await this.limiter.hit(`invite-token:ip:${req.ip}`, 30, 60);
    return this.invites.preview(p.token);
  }

  @Public()
  @Post('invites/accept')
  @Returns(acceptInviteResultSchema)
  async accept(
    @Body({ schema: acceptInviteBodySchema }) body: AcceptInviteBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ workspaceId: string }> {
    await this.limiter.hit(`invite-token:ip:${req.ip}`, 30, 60);
    const { userId, workspaceId } = await this.invites.accept(body);
    const tokens = await this.sessions.start(userId);
    setAuthCookies(res, tokens.access, tokens.refresh);
    return { workspaceId };
  }
}
