import { existsSync } from 'node:fs';
import { defineConfig, env } from 'prisma/config';

// One .env at the repo root serves the API, the worker and the Prisma CLI.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
