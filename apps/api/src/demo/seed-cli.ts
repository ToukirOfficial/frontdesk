/** pnpm --filter @frontdesk/api seed:demo — creates (or restores) the fictional demo clinic. */
import 'reflect-metadata';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '../config.js';
import { CoreModule } from '../core.module.js';
import { DemoService } from './demo.service.js';

const config = loadConfig();

@Module({ imports: [CoreModule.forConfig(config), BullModule], providers: [DemoService] })
class SeedModule {}

const app = await NestFactory.createApplicationContext(SeedModule, { logger: ['error', 'warn', 'log'] });
const id = await app.get(DemoService).seed();
console.log(`Demo clinic ready (workspace ${id}). The worker embeds its knowledge in the background.`);
await app.close();
