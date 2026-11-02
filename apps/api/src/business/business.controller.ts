import { Body, Controller, Delete, Get, Inject, Param, Put } from '@nestjs/common';
import {
  type AssistantSettings,
  type AssistantSettingsBody,
  assistantSettingsBodySchema,
  assistantSettingsSchema,
  type BusinessProfile,
  businessProfileSchema,
  type SlotwiseBody,
  slotwiseBodySchema,
  workspaceParamsSchema,
} from '@frontdesk/shared';
import { Member, Roles, type WorkspaceAuth } from '../common/auth.js';
import { Returns } from '../common/schema.js';
import { BusinessService } from './business.service.js';

@Controller('workspaces/:workspaceId')
@Roles('owner', 'admin')
export class BusinessController {
  constructor(@Inject(BusinessService) private readonly business: BusinessService) {}

  @Get('business')
  @Returns(businessProfileSchema)
  getProfile(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<BusinessProfile> {
    return this.business.getProfile(auth);
  }

  @Put('business')
  @Returns(businessProfileSchema)
  putProfile(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: businessProfileSchema }) body: BusinessProfile,
  ): Promise<BusinessProfile> {
    return this.business.putProfile(auth, body);
  }

  @Get('assistant')
  @Returns(assistantSettingsSchema)
  getAssistant(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<AssistantSettings> {
    return this.business.getAssistant(auth);
  }

  @Put('assistant')
  @Returns(assistantSettingsSchema)
  putAssistant(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: assistantSettingsBodySchema }) body: AssistantSettingsBody,
  ): Promise<AssistantSettings> {
    return this.business.putAssistant(auth, body);
  }

  @Put('slotwise')
  @Returns(assistantSettingsSchema)
  connectSlotwise(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: slotwiseBodySchema }) body: SlotwiseBody,
  ): Promise<AssistantSettings> {
    return this.business.connectSlotwise(auth, body);
  }

  @Delete('slotwise')
  @Returns(assistantSettingsSchema)
  disconnectSlotwise(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<AssistantSettings> {
    return this.business.disconnectSlotwise(auth);
  }
}
