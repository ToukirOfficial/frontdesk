import { Inject, Injectable } from '@nestjs/common';
import {
  type AssistantSettings,
  type AssistantSettingsBody,
  type BusinessProfile,
  DEFAULT_OPENING_HOURS,
  ErrorCode,
  openingHoursSchema,
  type SlotwiseBody,
} from '@frontdesk/shared';
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
    return this.getProfile(auth);
  }

  async getAssistant(auth: WorkspaceAuth): Promise<AssistantSettings> {
    const row = await this.prisma.assistantSettings.findUnique({ where: { workspaceId: auth.workspaceId } });
    return {
      preset: row?.preset ?? 'general',
      rules: row?.rules ?? '',
      slotwise: { connected: Boolean(row?.slotwiseKeyCipher), baseUrl: row?.slotwiseBaseUrl ?? null },
    };
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
