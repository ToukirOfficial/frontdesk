import { z } from 'zod';
import { instantSchema } from './common.js';

/**
 * Bring your own key. Gemini and "openai-compatible" (any endpoint speaking the OpenAI chat API, including Ollama)
 * go through the same client with a base URL. Model names always come from configuration: there is no default.
 */
export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini', 'openai-compatible'] as const;
export const aiProviderSchema = z.enum(AI_PROVIDERS);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  'openai-compatible': 'OpenAI-compatible (e.g. Ollama)',
};

/** Providers a demo visitor may use with their own key: fixed, well-known hosts only (no custom addresses). */
export const DEMO_AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export const demoAiProviderSchema = z.enum(DEMO_AI_PROVIDERS);

/** Model ids look like claude-…, gpt-…, gemini-…, llama3.1:8b or org/model. */
export const aiModelSchema = z
  .string()
  .trim()
  .min(1, 'Enter a model name')
  .max(120)
  .regex(/^[A-Za-z0-9._:/@-]+$/, 'Use the model’s id, e.g. as written in the provider’s docs');

export const aiKeySchema = z.string().trim().min(8, 'That key looks too short').max(500);

const aiFields = {
  provider: aiProviderSchema,
  model: aiModelSchema,
  /** Leave out to keep the saved key (same provider only). Optional for OpenAI-compatible endpoints (Ollama has none). */
  apiKey: aiKeySchema.optional(),
  /** OpenAI-compatible only, e.g. https://ollama.example.co.uk/v1 */
  baseUrl: z.url({ protocol: /^https?$/ }).max(300).optional(),
};

const needsBaseUrl = (v: { provider: AiProvider; baseUrl?: string }, ctx: z.RefinementCtx) => {
  if (v.provider === 'openai-compatible' && !v.baseUrl) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Enter the endpoint’s address' });
  }
};

/** PUT /workspaces/:id/ai. The key is write-only: encrypted at rest and never returned. */
export const aiSettingsBodySchema = z.object(aiFields).superRefine(needsBaseUrl);
export type AiSettingsBody = z.infer<typeof aiSettingsBodySchema>;

/** POST /workspaces/:id/ai/test: the same fields (test before saving), or none to test what's saved. */
export const aiTestBodySchema = z.union([aiSettingsBodySchema, z.object({}).strict()]);
export type AiTestBody = z.infer<typeof aiTestBodySchema>;

export const aiTestResultSchema = z.object({ ok: z.boolean(), message: z.string() });
export type AiTestResult = z.infer<typeof aiTestResultSchema>;

/** Which provider answers this workspace's visitors. `demo`: the public demo (replay, or a visitor's own key). */
export const aiSourceSchema = z.enum(['workspace', 'instance', 'none', 'demo']);
export type AiSource = z.infer<typeof aiSourceSchema>;

export const aiStatusSchema = z.object({
  workspace: z
    .object({
      provider: aiProviderSchema,
      model: z.string(),
      baseUrl: z.string().nullable(),
      /** Only ever the last 4 characters; null when no key is stored (keyless OpenAI-compatible endpoint). */
      keyLast4: z.string().nullable(),
      updatedAt: instantSchema,
    })
    .nullable(),
  /** The server's own key from .env, if the self-hoster set one. The key itself is never exposed. */
  instance: z.object({ provider: aiProviderSchema, model: z.string() }).nullable(),
  active: aiSourceSchema,
});
export type AiStatus = z.infer<typeof aiStatusSchema>;

/** Demo only: a visitor's own key, tied to their demo conversation, deleted after 24 hours. */
export const demoKeyBodySchema = z.object({
  token: z.string().min(20).max(2000),
  provider: demoAiProviderSchema,
  model: aiModelSchema,
  apiKey: aiKeySchema,
});
export type DemoKeyBody = z.infer<typeof demoKeyBodySchema>;

export const demoKeyInfoSchema = z.object({ provider: demoAiProviderSchema, model: z.string(), keyLast4: z.string() });
export type DemoKeyInfo = z.infer<typeof demoKeyInfoSchema>;

export const DEMO_KEY_TTL_SEC = 24 * 60 * 60;

/** A key's last 4 characters, the only part of it ever shown again. */
export const last4 = (key: string): string => key.trim().slice(-4);
