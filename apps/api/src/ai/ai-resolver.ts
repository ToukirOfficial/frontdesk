import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AiProvider,
  aiProviderSchema,
  type AiSource,
  DEMO_KEY_TTL_SEC,
  type DemoKeyInfo,
  demoAiProviderSchema,
  last4,
} from '@frontdesk/shared';
import { z } from 'zod';
import { decrypt, encrypt } from '../common/crypto.js';
import { APP_CONFIG, type AppConfig, missingAiSettings } from '../config.js';
import { guardedFetch } from '../net/safe-fetch.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { ChatProvider, ProviderSpec } from './chat-provider.js';
import { createProvider, instanceSpec } from './providers.js';

export type ResolvedAi =
  | { kind: 'live'; provider: ChatProvider; source: 'workspace' | 'instance' | 'visitor' }
  | { kind: 'replay' }
  | { kind: 'none' };

/** Redis key of a demo visitor's own key. Redis deletes it after 24 hours (TTL). */
export const demoKeyRedisKey = (conversationId: string) => `demo-key:${conversationId}`;

const demoSealedSchema = z.object({ provider: demoAiProviderSchema, model: z.string(), apiKey: z.string() });

/**
 * Who answers a visitor, decided per message:
 * - the public demo: the visitor's own key for this conversation if they added one, otherwise replayed sample answers
 *   (the demo never spends the instance's key);
 * - otherwise the workspace's own key, then the instance key from .env, then nobody ("No AI provider configured").
 * A workspace's key is looked up by that workspace's id only, so it can never answer for another workspace.
 */
@Injectable()
export class AiResolver {
  private readonly log = new Logger('AI');
  private readonly instance: ProviderSpec | null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.instance = instanceSpec(config);
    const missing = missingAiSettings(config);
    if (missing.length) this.log.warn(`AI_PROVIDER is set but ${missing.join(', ')} is missing; running without an instance AI provider`);
  }

  /** Provider and model of the instance key (never the key itself). */
  instanceInfo(): { provider: AiProvider; model: string } | null {
    return this.instance && this.config.AI_PROVIDER !== 'fake' ? { provider: this.instance.provider, model: this.instance.model } : null;
  }

  hasInstance(): boolean {
    return this.instance !== null;
  }

  build(spec: ProviderSpec): ChatProvider {
    return createProvider(spec, this.config.NODE_ENV);
  }

  /**
   * A spec for an address and key typed into the dashboard. An OpenAI-compatible base URL goes through the SSRF
   * guard on every request (only the instance's own .env may point at private addresses such as a local Ollama).
   */
  dashboardSpec(input: { provider: AiProvider; model: string; apiKey: string; baseUrl?: string | null }): ProviderSpec {
    const compat = input.provider === 'openai-compatible';
    return {
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      baseUrl: compat ? (input.baseUrl ?? undefined) : undefined,
      fetch: compat
        ? guardedFetch({ allowHttp: this.config.NODE_ENV !== 'production', allowPrivate: this.config.ALLOW_PRIVATE_URLS })
        : undefined,
    };
  }

  /** The workspace's own provider, decrypted, or null. */
  async workspaceSpec(workspaceId: string): Promise<ProviderSpec | null> {
    const row = await this.prisma.aiSettings.findUnique({ where: { workspaceId } });
    if (!row) return null;
    const provider = aiProviderSchema.safeParse(row.provider);
    if (!provider.success) return null;
    if (!row.keyCipher && provider.data !== 'openai-compatible') return null;
    return this.dashboardSpec({
      provider: provider.data,
      model: row.model,
      apiKey: row.keyCipher ? decrypt(row.keyCipher, this.config.ENCRYPTION_KEY) : '',
      baseUrl: row.baseUrl,
    });
  }

  async forChat(workspaceId: string, isDemo: boolean, conversationId: string): Promise<ResolvedAi> {
    if (isDemo) {
      const visitor = await this.demoKey(conversationId);
      return visitor ? { kind: 'live', source: 'visitor', provider: this.build(this.dashboardSpec(visitor)) } : { kind: 'replay' };
    }
    const own = await this.workspaceSpec(workspaceId);
    if (own) return { kind: 'live', source: 'workspace', provider: this.build(own) };
    if (this.instance) return { kind: 'live', source: 'instance', provider: this.build(this.instance) };
    return { kind: 'none' };
  }

  /** Who answers this workspace's visitors, without decrypting anything. */
  async source(workspaceId: string, isDemo: boolean): Promise<AiSource> {
    if (isDemo) return 'demo';
    const row = await this.prisma.aiSettings.findUnique({
      where: { workspaceId },
      select: { provider: true, keyCipher: true },
    });
    if (row && (row.keyCipher || row.provider === 'openai-compatible')) return 'workspace';
    return this.instance ? 'instance' : 'none';
  }

  // Demo visitors' own keys: sealed with ENCRYPTION_KEY, tied to one conversation, gone after 24 hours.

  async setDemoKey(conversationId: string, value: z.infer<typeof demoSealedSchema>): Promise<void> {
    const sealed = encrypt(JSON.stringify(value), this.config.ENCRYPTION_KEY);
    await this.redis.client.set(demoKeyRedisKey(conversationId), sealed, 'EX', DEMO_KEY_TTL_SEC);
  }

  async deleteDemoKey(conversationId: string): Promise<void> {
    await this.redis.client.del(demoKeyRedisKey(conversationId));
  }

  private async demoKey(conversationId: string): Promise<z.infer<typeof demoSealedSchema> | null> {
    const sealed = await this.redis.client.get(demoKeyRedisKey(conversationId));
    if (!sealed) return null;
    try {
      const parsed = demoSealedSchema.safeParse(JSON.parse(decrypt(sealed, this.config.ENCRYPTION_KEY)));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async demoKeyInfo(conversationId: string): Promise<DemoKeyInfo | null> {
    const v = await this.demoKey(conversationId);
    return v ? { provider: v.provider, model: v.model, keyLast4: last4(v.apiKey) } : null;
  }

  /** Nightly demo reset: every visitor key goes, whatever its remaining TTL. */
  async deleteAllDemoKeys(): Promise<void> {
    const prefix = `${this.config.REDIS_PREFIX}:`;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', `${prefix}${demoKeyRedisKey('*')}`, 'COUNT', 500);
      cursor = next;
      if (keys.length) await this.redis.client.del(...keys.map((k) => k.slice(prefix.length)));
    } while (cursor !== '0');
  }
}
