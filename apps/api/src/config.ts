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
  return config;
};

export const APP_CONFIG = Symbol('APP_CONFIG');
