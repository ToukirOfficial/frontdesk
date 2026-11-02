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
  /** Uploaded knowledge files live here, outside any public folder. */
  STORAGE_DIR: z.string().min(1).default('./storage'),
  /** local: a small model on this machine (no API key). openai: OpenAI embeddings. fake: tests only. */
  EMBEDDING_PROVIDER: z.enum(['local', 'openai', 'fake']).default('local'),
  LOCAL_EMBEDDING_MODEL: z.string().min(1).default('Xenova/all-MiniLM-L6-v2'),
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),
  /** Where the local model is downloaded to on first use. */
  MODEL_CACHE_DIR: z.string().min(1).default('./storage/models'),
  OPENAI_API_KEY: z.string().optional().default(''),
  /**
   * Lets server-side fetches (website import, Slotwise) reach private and loopback addresses. For local development
   * and tests only (e.g. a Slotwise on localhost); refused in production.
   */
  ALLOW_PRIVATE_URLS: flag,
});

export type AppConfig = z.infer<typeof configSchema>;

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
  if (config.EMBEDDING_PROVIDER === 'fake' && config.NODE_ENV !== 'test') {
    throw new Error('EMBEDDING_PROVIDER=fake is for tests only');
  }
  if (config.EMBEDDING_PROVIDER === 'openai' && !config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
  }
  return config;
};

export const APP_CONFIG = Symbol('APP_CONFIG');
