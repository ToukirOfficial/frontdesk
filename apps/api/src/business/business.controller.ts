import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type AssistantSettings,
  type AssistantSettingsBody,
  assistantSettingsBodySchema,
  assistantSettingsSchema,
  type BusinessProfile,
  businessProfileSchema,
  ErrorCode,
  MAX_AVATAR_BYTES,
  type SlotwiseBody,
  slotwiseBodySchema,
  type WidgetSettingsBody,
  widgetSettingsBodySchema,
  workspaceParamsSchema,
} from '@frontdesk/shared';
import { Member, Roles, type WorkspaceAuth } from '../common/auth.js';
import { AppError } from '../common/errors.js';
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

  @Put('widget')
  @Returns(assistantSettingsSchema)
  putWidget(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: widgetSettingsBodySchema }) body: WidgetSettingsBody,
  ): Promise<AssistantSettings> {
    return this.business.putWidget(auth, body);
  }

  @Post('widget/avatar')
  @Returns(assistantSettingsSchema)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AVATAR_BYTES, files: 1, fields: 2 } }))
  putAvatar(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ): Promise<AssistantSettings> {
    if (!file) throw new AppError(400, ErrorCode.FILE_REJECTED, 'Choose an image.');
    return this.business.putAvatar(auth, file);
  }

  @Delete('widget/avatar')
  @Returns(assistantSettingsSchema)
  deleteAvatar(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<AssistantSettings> {
    return this.business.deleteAvatarFor(auth);
  }
}
