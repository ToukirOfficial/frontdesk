import { z } from 'zod';

const flag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(8125),
  WEB_URL: z.url().default('http://localhost:8025'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379/7'),
  /** Every Redis key, cache entry and queue starts with this, so a shared Redis stays tidy. */
  REDIS_PREFIX: z.string().min(1).default('frontdesk'),
  JWT_SECRET: z.string().min(32),
  /** HMAC key for login codes. */
  CODE_SECRET: z.string().min(32),
  /** AES-256-GCM key for stored third-party API keys: 32 bytes as 64 hex characters. */
  ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'ENCRYPTION_KEY must be 64 hex characters'),
  SMTP_URL: z.string().optional().default(''),
  MAIL_FROM: z.string().default('Frontdesk <no-reply@frontdesk.example>'),
  /** Public demo: seeded fictional clinic, strict limits, no real emails, nightly reset. */
  DEMO_MODE: flag,
  /** The demo clinic's hard monthly AI limit, in tokens. */
  DEMO_MONTHLY_TOKEN_CAP: z.coerce.number().int().min(0).default(300_000),
  /**
   * Which proxies may set X-Forwarded-For. loopback: a proxy on this machine (default). private: also private
   * networks, e.g. the web container in docker compose.
   */
  TRUST_PROXY: z.enum(['loopback', 'private']).default('loopback'),
  /** Uploaded knowledge files live here, outside any public folder. */
  STORAGE_DIR: z.string().min(1).default('./storage'),
  /** local: a small model on this machine (no API key). openai: OpenAI embeddings. fake: tests only. */
  EMBEDDING_PROVIDER: z.enum(['local', 'openai', 'fake']).default('local'),
  LOCAL_EMBEDDING_MODEL: z.string().min(1).default('Xenova/all-MiniLM-L6-v2'),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  /** Where the local model is downloaded to on first use. */
  MODEL_CACHE_DIR: z.string().min(1).default('./storage/models'),
  /** Only for EMBEDDING_PROVIDER=openai. Chat keys are set below (AI_API_KEY) or per workspace in the dashboard. */
  OPENAI_API_KEY: z.string().optional().default(''),
  /**
   * Optional instance-wide chat provider (bring your own key). Empty: none, and each workspace adds its own key in
   * Settings → AI provider. fake: tests only.
   */
  AI_PROVIDER: z.enum(['', 'anthropic', 'openai', 'gemini', 'openai-compatible', 'fake']).default(''),
  /** The model id, exactly as the provider names it. There is deliberately no default. */
  AI_MODEL: z.string().trim().optional().default(''),
  AI_API_KEY: z.string().trim().optional().default(''),
  /** openai-compatible only, e.g. http://localhost:11434/v1 for Ollama on this machine. */
  AI_BASE_URL: z.string().trim().optional().default(''),
  /** Anthropic only, instance key only: how hard the model thinks. Empty = the model's default. */
  ANTHROPIC_EFFORT: z.enum(['', 'low', 'medium', 'high']).default(''),
  /**
   * Lets server-side fetches (website import, Slotwise) reach private and loopback addresses. For local development
   * and tests only (e.g. a Slotwise on localhost); refused in production.
   */
  ALLOW_PRIVATE_URLS: flag,
});

export type AppConfig = z.infer<typeof configSchema>;

/** The AI settings only, for scripts that need a provider but no database (eval runner, demo recorder). */
export const aiConfigSchema = configSchema.pick({
  NODE_ENV: true,
  AI_PROVIDER: true,
  AI_MODEL: true,
  AI_API_KEY: true,
  AI_BASE_URL: true,
  ANTHROPIC_EFFORT: true,
  EMBEDDING_PROVIDER: true,
  LOCAL_EMBEDDING_MODEL: true,
  OPENAI_EMBEDDING_MODEL: true,
  OPENAI_API_KEY: true,
  MODEL_CACHE_DIR: true,
});
export type AiConfig = z.infer<typeof aiConfigSchema>;

/**
 * What's missing from the instance AI settings, if a provider is chosen. The app still starts without them (it then
 * runs with no instance provider); names only, never values.
 */
export const missingAiSettings = (c: AiConfig): string[] => {
  if (!c.AI_PROVIDER || c.AI_PROVIDER === 'fake') return [];
  const missing: string[] = [];
  if (!c.AI_MODEL) missing.push('AI_MODEL');
  if (!c.AI_API_KEY && c.AI_PROVIDER !== 'openai-compatible') missing.push('AI_API_KEY');
  if (!c.AI_BASE_URL && c.AI_PROVIDER === 'openai-compatible') missing.push('AI_BASE_URL');
  return missing;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    // Names only, never values: the env holds secrets.
    const keys = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${keys}`);
  }
  const config = parsed.data;
  if (config.NODE_ENV === 'production' && !config.SMTP_URL && !config.DEMO_MODE) {
    throw new Error('SMTP_URL is required in production (login codes are sent by email)');
  }
  if (config.NODE_ENV === 'production' && config.ALLOW_PRIVATE_URLS) {
    throw new Error('ALLOW_PRIVATE_URLS must not be set in production');
  }
  if (config.AI_PROVIDER === 'fake' && config.NODE_ENV !== 'test') {
    throw new Error('AI_PROVIDER=fake is for tests only');
  }
  if (config.EMBEDDING_PROVIDER === 'fake' && config.NODE_ENV !== 'test') {
    throw new Error('EMBEDDING_PROVIDER=fake is for tests only');
  }
  if (config.EMBEDDING_PROVIDER === 'openai' && !config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
  }
  return config;
};

export const APP_CONFIG = Symbol('APP_CONFIG');

export const loadAiConfig = (env: NodeJS.ProcessEnv = process.env): AiConfig => {
  const parsed = aiConfigSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  if (parsed.data.AI_PROVIDER === 'fake' && parsed.data.NODE_ENV !== 'test') throw new Error('AI_PROVIDER=fake is for tests only');
  return parsed.data;
};
