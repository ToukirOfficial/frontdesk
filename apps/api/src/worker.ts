import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { makeLogger } from './common/logger.js';
import { loadConfig } from './config.js';
import { WorkerModule } from './worker.module.js';

const config = loadConfig();
const app = await NestFactory.createApplicationContext(WorkerModule.forConfig(config), {
  logger: makeLogger(config.NODE_ENV),
});
app.enableShutdownHooks();
