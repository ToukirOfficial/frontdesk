import { Controller, Get, Inject } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../common/auth.js';
import { notFound } from '../common/errors.js';
import { Returns } from '../common/schema.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DemoService } from './demo.service.js';

const demoSchema = z.object({ publicKey: z.string() });

/** GET /api/demo: the demo clinic's widget key, for the /demo page. Exists only with DEMO_MODE=true. */
@Controller('demo')
export class DemoController {
  constructor(
    @Inject(DemoService) private readonly demo: DemoService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get()
  @Returns(demoSchema)
  async get() {
    const key = this.config.DEMO_MODE ? await this.demo.publicKey() : null;
    if (!key) throw notFound();
    return { publicKey: key };
  }
}
