import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  type AssignableRole,
  createWorkspaceBodySchema,
  type Member,
  type MemberList,
  memberListSchema,
  memberParamsSchema,
  memberSchema,
  okSchema,
  updateMemberBodySchema,
  updateWorkspaceBodySchema,
  type Workspace,
  ErrorCode,
  type WorkspaceBody,
  type WorkspaceList,
  workspaceListSchema,
  workspaceParamsSchema,
  workspaceSchema,
} from '@frontdesk/shared';
import { AnyMember, Auth, LoggedIn, Member as CurrentMember, Roles, type UserAuth, type WorkspaceAuth } from '../common/auth.js';
import { AppError } from '../common/errors.js';
import { Returns } from '../common/schema.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { WorkspacesService } from './workspaces.service.js';

const OK = { ok: true } as const;

@Controller('workspaces')
export class WorkspacesController {
  constructor(
    @Inject(WorkspacesService) private readonly workspaces: WorkspacesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @LoggedIn()
  @Get()
  @Returns(workspaceListSchema)
  async list(@Auth() auth: UserAuth): Promise<WorkspaceList> {
    return { items: await this.workspaces.listForUser(auth.userId) };
  }

  @LoggedIn()
  @Post()
  @Returns(workspaceSchema, 201)
  create(@Auth() auth: UserAuth, @Body({ schema: createWorkspaceBodySchema }) body: WorkspaceBody): Promise<Workspace> {
    if (this.config.DEMO_MODE) throw new AppError(403, ErrorCode.DEMO_MODE, 'This is a public demo, so new workspaces are switched off.');
    return this.workspaces.create(auth.userId, body.name);
  }

  @AnyMember()
  @Get(':workspaceId')
  @Returns(workspaceSchema)
  get(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @CurrentMember() auth: WorkspaceAuth,
  ): Promise<Workspace> {
    return this.workspaces.get(auth);
  }

  @Roles('owner', 'admin')
  @Patch(':workspaceId')
  @Returns(workspaceSchema)
  rename(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @CurrentMember() auth: WorkspaceAuth,
    @Body({ schema: updateWorkspaceBodySchema }) body: WorkspaceBody,
  ): Promise<Workspace> {
    return this.workspaces.rename(auth, body.name);
  }

  @Roles('owner')
  @Delete(':workspaceId')
  @Returns(okSchema)
  async remove(@Param({ schema: workspaceParamsSchema }) _p: unknown, @CurrentMember() auth: WorkspaceAuth) {
    await this.workspaces.remove(auth);
    return OK;
  }

  @Roles('owner', 'admin')
  @Get(':workspaceId/members')
  @Returns(memberListSchema)
  async members(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @CurrentMember() auth: WorkspaceAuth,
  ): Promise<MemberList> {
    return { items: await this.workspaces.members(auth) };
  }

  @Roles('owner')
  @Patch(':workspaceId/members/:userId')
  @Returns(memberSchema)
  changeRole(
    @Param({ schema: memberParamsSchema }) p: { userId: string },
    @CurrentMember() auth: WorkspaceAuth,
    @Body({ schema: updateMemberBodySchema }) body: { role: AssignableRole },
  ): Promise<Member> {
    return this.workspaces.changeRole(auth, p.userId, body.role);
  }

  /** Remove someone, or leave (your own user id). The service checks who may remove whom. */
  @AnyMember()
  @Delete(':workspaceId/members/:userId')
  @Returns(okSchema)
  async removeMember(@Param({ schema: memberParamsSchema }) p: { userId: string }, @CurrentMember() auth: WorkspaceAuth) {
    await this.workspaces.removeMember(auth, p.userId);
    return OK;
  }
}
