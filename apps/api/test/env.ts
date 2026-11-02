import { existsSync } from 'node:fs';

// Every test file: load the root .env (locally), then point everything at the test database and test Redis keys.
if (existsSync('../../.env')) process.loadEnvFile('../../.env');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.REDIS_PREFIX = 'frontdesk-test';
process.env.WEB_URL = 'http://localhost:8025';
process.env.DEMO_MODE = 'false';
process.env.EMBEDDING_PROVIDER = 'fake';
process.env.STORAGE_DIR = `${process.cwd()}/tmp/test-storage`;
process.env.ALLOW_PRIVATE_URLS = 'false';
process.env.AI_PROVIDER = 'fake';
