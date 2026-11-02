import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AiSettingsBody,
  type AiStatus,
  type AiTestBody,
  type AiTestResult,
  aiProviderSchema,
  ErrorCode,
  last4,
} from '@frontdesk/shared';
import type { WorkspaceAuth } from '../common/auth.js';
import { encrypt } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { checkUrlShape, resolvePublic, UrlRejectedError } from '../net/safe-fetch.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiResolver } from './ai-resolver.js';
import { classifyProviderError, FAILURE_MESSAGES, type ProviderSpec } from './chat-provider.js';

const PING_TIMEOUT_MS = 20_000;

/** Settings → AI provider. The key is write-only: stored encrypted, never returned (only its last 4 characters). */
@Injectable()
export class AiSettingsService {
  private readonly log = new Logger('AiSettings');

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiResolver) private readonly ai: AiResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async status(auth: WorkspaceAuth): Promise<AiStatus> {
    const [ws, row] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId }, select: { isDemo: true } }),
      this.prisma.aiSettings.findUnique({ where: { workspaceId: auth.workspaceId } }),
    ]);
    const provider = aiProviderSchema.safeParse(row?.provider);
    return {
      workspace:
        row && provider.success
          ? { provider: provider.data, model: row.model, baseUrl: row.baseUrl, keyLast4: row.keyLast4, updatedAt: row.updatedAt.toISOString() }
          : null,
      instance: this.ai.instanceInfo(),
      active: await this.ai.source(auth.workspaceId, ws.isDemo),
    };
  }

  async save(auth: WorkspaceAuth, body: AiSettingsBody): Promise<AiStatus> {
    await this.refuseDemo(auth);
    const baseUrl = body.provider === 'openai-compatible' ? await this.checkBaseUrl(body.baseUrl ?? '') : null;
    const before = await this.prisma.aiSettings.findUnique({ where: { workspaceId: auth.workspaceId } });
    let key: { keyCipher: string | null; keyLast4: string | null };
    if (body.apiKey) {
      key = { keyCipher: encrypt(body.apiKey, this.config.ENCRYPTION_KEY), keyLast4: last4(body.apiKey) };
    } else if (before?.keyCipher && before.provider === body.provider) {
      key = { keyCipher: before.keyCipher, keyLast4: before.keyLast4 }; // keep the saved key
    } else if (body.provider === 'openai-compatible') {
      key = { keyCipher: null, keyLast4: null }; // e.g. Ollama: no key
    } else {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Paste the API key.', { apiKey: 'Paste the API key' });
    }
    const data = { provider: body.provider, model: body.model, baseUrl, ...key };
    await this.prisma.aiSettings.upsert({
      where: { workspaceId: auth.workspaceId },
      create: { workspaceId: auth.workspaceId, ...data },
      update: data,
    });
    this.log.log(`AI provider saved for workspace ${auth.workspaceId}`); // never the key, not even its last 4
    return this.status(auth);
  }

  async remove(auth: WorkspaceAuth): Promise<AiStatus> {
    await this.prisma.aiSettings.deleteMany({ where: { workspaceId: auth.workspaceId } });
    return this.status(auth);
  }

  /** One tiny request with the pasted settings (before saving) or the saved ones. */
  async test(auth: WorkspaceAuth, body: AiTestBody): Promise<AiTestResult> {
    let spec: ProviderSpec | null;
    if ('provider' in body) {
      await this.refuseDemo(auth);
      const baseUrl = body.provider === 'openai-compatible' ? await this.checkBaseUrl(body.baseUrl ?? '') : null;
      let apiKey = body.apiKey ?? '';
      if (!apiKey) {
        const saved = await this.ai.workspaceSpec(auth.workspaceId);
        if (saved?.provider === body.provider) apiKey = saved.apiKey;
        else if (body.provider !== 'openai-compatible') {
          throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Paste the API key to test it.', { apiKey: 'Paste the API key' });
        }
      }
      spec = this.ai.dashboardSpec({ provider: body.provider, model: body.model, apiKey, baseUrl });
    } else {
      spec = await this.ai.workspaceSpec(auth.workspaceId);
      if (!spec) throw new AppError(400, ErrorCode.AI_NOT_CONFIGURED, 'Save a provider and key first.');
    }
    return pingProvider(this.ai.build(spec));
  }

  private async refuseDemo(auth: WorkspaceAuth): Promise<void> {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId }, select: { isDemo: true } });
    if (ws.isDemo) {
      throw new AppError(403, ErrorCode.DEMO_MODE, 'The demo uses sample answers. Visitors can try it with their own key in the chat.');
    }
  }

  /** Admin-typed address: same SSRF rules as website import (public addresses only, except in development). */
  private async checkBaseUrl(raw: string): Promise<string> {
    try {
      const url = checkUrlShape(raw, this.config.NODE_ENV !== 'production');
      await resolvePublic(url.hostname, this.config.ALLOW_PRIVATE_URLS);
      return url.origin + url.pathname.replace(/\/+$/, '');
    } catch (err) {
      const msg = err instanceof UrlRejectedError ? err.message : 'Invalid address.';
      throw new AppError(400, ErrorCode.URL_REJECTED, msg, { baseUrl: msg });
    }
  }
}

/** Shared with the demo's "use your own key". The provider's own error text is never passed on. */
export const pingProvider = async (provider: { ping(): Promise<void> }): Promise<AiTestResult> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      provider.ping(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), PING_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, message: 'It works: the provider answered.' };
  } catch (err) {
    return { ok: false, message: FAILURE_MESSAGES[classifyProviderError(err)] };
  } finally {
    clearTimeout(timer);
  }
};
