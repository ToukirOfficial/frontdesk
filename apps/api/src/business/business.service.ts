import { Inject, Injectable } from '@nestjs/common';
import {
  type AssistantSettings,
  type AssistantSettingsBody,
  type BusinessProfile,
  DEFAULT_OPENING_HOURS,
  ErrorCode,
  openingHoursSchema,
  type SlotwiseBody,
  type WidgetSettingsBody,
} from '@frontdesk/shared';
import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import { deleteAvatar, saveAvatar } from '../chat/avatars.js';
import { widgetCacheKey } from '../chat/widget.service.js';
import type { WorkspaceAuth } from '../common/auth.js';
import { encrypt } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { checkUrlShape, UrlRejectedError } from '../net/safe-fetch.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

/** Cache key for what the assistant reads on every message (business details, rules). */
export const assistantContextKey = (workspaceId: string) => `assistant-context:${workspaceId}`;

@Injectable()
export class BusinessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getProfile(auth: WorkspaceAuth): Promise<BusinessProfile> {
    const row = await this.prisma.businessProfile.findUnique({ where: { workspaceId: auth.workspaceId } });
    if (!row) {
      const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId }, select: { name: true } });
      return { name: ws.name, address: '', openingHours: DEFAULT_OPENING_HOURS, email: '', phone: '', bookingUrl: '' };
    }
    const hours = openingHoursSchema.safeParse(row.openingHours);
    return {
      name: row.name,
      address: row.address,
      openingHours: hours.success ? hours.data : DEFAULT_OPENING_HOURS,
      email: row.email,
      phone: row.phone,
      bookingUrl: row.bookingUrl,
    };
  }

  async putProfile(auth: WorkspaceAuth, body: BusinessProfile): Promise<BusinessProfile> {
    await this.prisma.businessProfile.upsert({
      where: { workspaceId: auth.workspaceId },
      create: { workspaceId: auth.workspaceId, ...body },
      update: body,
    });
    await this.redis.del(assistantContextKey(auth.workspaceId));
    await this.clearWidgetCache(auth.workspaceId); // the widget shows the business name
    return this.getProfile(auth);
  }

  async getAssistant(auth: WorkspaceAuth): Promise<AssistantSettings> {
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: auth.workspaceId },
      include: { assistant: true },
    });
    const row = ws.assistant;
    return {
      preset: row?.preset ?? 'general',
      rules: row?.rules ?? '',
      slotwise: { connected: Boolean(row?.slotwiseKeyCipher), baseUrl: row?.slotwiseBaseUrl ?? null },
      widget: {
        publicKey: ws.publicKey,
        greeting: row?.greeting ?? 'Hello! How can I help you today?',
        brandColour: row?.brandColour ?? '#0f766e',
        position: row?.position === 'left' ? 'left' : 'right',
        allowedOrigins: ws.allowedOrigins,
        hasAvatar: Boolean(row?.avatarName),
      },
    };
  }

  async putWidget(auth: WorkspaceAuth, body: WidgetSettingsBody): Promise<AssistantSettings> {
    const { allowedOrigins, ...look } = body;
    const ws = await this.prisma.$transaction(async (tx) => {
      await tx.assistantSettings.upsert({
        where: { workspaceId: auth.workspaceId },
        create: { workspaceId: auth.workspaceId, ...look },
        update: look,
      });
      return tx.workspace.update({
        where: { id: auth.workspaceId },
        data: { allowedOrigins: [...new Set(allowedOrigins)] },
        select: { publicKey: true },
      });
    });
    await this.redis.del(widgetCacheKey(ws.publicKey));
    return this.getAssistant(auth);
  }

  /** PNG, JPEG or WebP up to 256 KB, checked by content, stored under a random name. */
  async putAvatar(auth: WorkspaceAuth, file: { buffer: Buffer; size: number }): Promise<AssistantSettings> {
    // Everyone visiting the demo would see it: no image uploads there.
    if ((await this.prisma.workspace.findUnique({ where: { id: auth.workspaceId }, select: { isDemo: true } }))?.isDemo) {
      throw new AppError(403, ErrorCode.DEMO_MODE, 'Avatar uploads are switched off in the public demo.');
    }
    const type = await fileTypeFromBuffer(file.buffer);
    const ext = type?.mime === 'image/png' ? 'png' : type?.mime === 'image/jpeg' ? 'jpg' : type?.mime === 'image/webp' ? 'webp' : null;
    if (!ext) throw new AppError(400, ErrorCode.FILE_REJECTED, 'Use a PNG, JPEG or WebP image.');
    const name = `${randomUUID()}.${ext}`;
    await saveAvatar(this.config, name, file.buffer);
    const before = await this.prisma.assistantSettings.findUnique({ where: { workspaceId: auth.workspaceId } });
    await this.prisma.assistantSettings.upsert({
      where: { workspaceId: auth.workspaceId },
      create: { workspaceId: auth.workspaceId, avatarName: name },
      update: { avatarName: name },
    });
    if (before?.avatarName) await deleteAvatar(this.config, before.avatarName);
    await this.clearWidgetCache(auth.workspaceId);
    return this.getAssistant(auth);
  }

  async deleteAvatarFor(auth: WorkspaceAuth): Promise<AssistantSettings> {
    const before = await this.prisma.assistantSettings.findUnique({ where: { workspaceId: auth.workspaceId } });
    if (before?.avatarName) {
      await this.prisma.assistantSettings.update({ where: { id: before.id }, data: { avatarName: null } });
      await deleteAvatar(this.config, before.avatarName);
      await this.clearWidgetCache(auth.workspaceId);
    }
    return this.getAssistant(auth);
  }

  private async clearWidgetCache(workspaceId: string): Promise<void> {
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { publicKey: true } });
    if (ws) await this.redis.del(widgetCacheKey(ws.publicKey));
  }

  async putAssistant(auth: WorkspaceAuth, body: AssistantSettingsBody): Promise<AssistantSettings> {
    await this.prisma.assistantSettings.upsert({
      where: { workspaceId: auth.workspaceId },
      create: { workspaceId: auth.workspaceId, ...body },
      update: body,
    });
    await this.redis.del(assistantContextKey(auth.workspaceId));
    return this.getAssistant(auth);
  }

  /** Stores the Slotwise key encrypted (AES-256-GCM). It is never sent back, only "connected". */
  async connectSlotwise(auth: WorkspaceAuth, body: SlotwiseBody): Promise<AssistantSettings> {
    let baseUrl: string;
    try {
      const url = checkUrlShape(body.baseUrl, this.config.NODE_ENV !== 'production');
      baseUrl = url.origin + url.pathname.replace(/\/+$/, '');
    } catch (err) {
      const msg = err instanceof UrlRejectedError ? err.message : 'Invalid address.';
      throw new AppError(400, ErrorCode.URL_REJECTED, msg, { baseUrl: msg });
    }
    const cipher = encrypt(body.apiKey, this.config.ENCRYPTION_KEY);
    await this.prisma.assistantSettings.upsert({
      where: { workspaceId: auth.workspaceId },
      create: { workspaceId: auth.workspaceId, slotwiseBaseUrl: baseUrl, slotwiseKeyCipher: cipher },
      update: { slotwiseBaseUrl: baseUrl, slotwiseKeyCipher: cipher },
    });
    return this.getAssistant(auth);
  }

  async disconnectSlotwise(auth: WorkspaceAuth): Promise<AssistantSettings> {
    await this.prisma.assistantSettings.updateMany({
      where: { workspaceId: auth.workspaceId },
      data: { slotwiseBaseUrl: null, slotwiseKeyCipher: null },
    });
    return this.getAssistant(auth);
  }
}
