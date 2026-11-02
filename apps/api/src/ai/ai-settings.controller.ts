import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import {
  type AiSettingsBody,
  aiSettingsBodySchema,
  type AiStatus,
  aiStatusSchema,
  type AiTestBody,
  aiTestBodySchema,
  type AiTestResult,
  aiTestResultSchema,
  workspaceParamsSchema,
} from '@frontdesk/shared';
import { Member, Roles, type WorkspaceAuth } from '../common/auth.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Returns } from '../common/schema.js';
import { AiSettingsService } from './ai-settings.service.js';

/** Settings → AI provider (bring your own key). Owners and admins only. */
@Controller('workspaces/:workspaceId/ai')
@Roles('owner', 'admin')
export class AiSettingsController {
  constructor(
    @Inject(AiSettingsService) private readonly settings: AiSettingsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Get()
  @Returns(aiStatusSchema)
  get(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<AiStatus> {
    return this.settings.status(auth);
  }

  @Put()
  @Returns(aiStatusSchema)
  async put(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: aiSettingsBodySchema }) body: AiSettingsBody,
  ): Promise<AiStatus> {
    await this.limiter.hit(`ai-settings:ws:${auth.workspaceId}`, 20, 10 * 60);
    return this.settings.save(auth, body);
  }

  @Delete()
  @Returns(aiStatusSchema)
  remove(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<AiStatus> {
    return this.settings.remove(auth);
  }

  /** Makes one tiny request. Always 200: `ok` says whether the provider accepted it. */
  @Post('test')
  @Returns(aiTestResultSchema)
  async test(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: aiTestBodySchema }) body: AiTestBody,
  ): Promise<AiTestResult> {
    await this.limiter.hit(`ai-test:ws:${auth.workspaceId}`, 10, 10 * 60, 'Too many tests. Try again in a few minutes.');
    return this.settings.test(auth, body);
  }
}
