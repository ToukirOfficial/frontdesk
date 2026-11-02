import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Brings the test database up to the latest migration once per run. Refuses to touch a non-test database. */
export default function setup(): void {
  if (existsSync('../../.env')) process.loadEnvFile('../../.env');
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  if (!new URL(url).pathname.includes('test')) throw new Error('TEST_DATABASE_URL must point at a test database');
  execSync('pnpm exec prisma migrate deploy', { stdio: 'ignore', env: { ...process.env, DATABASE_URL: url } });
}
