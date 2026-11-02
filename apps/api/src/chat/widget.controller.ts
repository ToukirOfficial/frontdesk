import { createReadStream } from 'node:fs';
import { Body, Controller, Get, Inject, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import {
  publicKeyParamsSchema,
  type WidgetConfig,
  widgetConfigSchema,
  type WidgetSession,
  widgetSessionBodySchema,
  widgetSessionSchema,
} from '@frontdesk/shared';
import type { Request, Response } from 'express';
import { Public } from '../common/auth.js';
import { notFound } from '../common/errors.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Returns } from '../common/schema.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { avatarPath } from './avatars.js';
import { WidgetService } from './widget.service.js';

/**
 * Routes the widget calls from customers' websites. Public, no cookies, any origin at the CORS level; the
 * workspace's allowed-sites list is checked here and when the socket connects.
 */
@Controller('widget/:publicKey')
@Public()
export class WidgetController {
  constructor(
    @Inject(WidgetService) private readonly widgets: WidgetService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('config')
  @Returns(widgetConfigSchema)
  async getConfig(@Param({ schema: publicKeyParamsSchema }) p: { publicKey: string }, @Req() req: Request): Promise<WidgetConfig> {
    await this.limiter.hit(`widget-config:ip:${req.ip}`, 120, 60);
    const info = await this.widgets.byKey(p.publicKey);
    this.widgets.checkOrigin(info, req.get('origin'));
    return this.widgets.config(info, 'chat');
  }

  @Post('session')
  @Returns(widgetSessionSchema)
  async session(
    @Param({ schema: publicKeyParamsSchema }) p: { publicKey: string },
    @Body({ schema: widgetSessionBodySchema }) body: { token?: string },
    @Req() req: Request,
  ): Promise<WidgetSession> {
    await this.limiter.hit(`widget-session:ip:${req.ip}`, 30, 60);
    const info = await this.widgets.byKey(p.publicKey);
    this.widgets.checkOrigin(info, req.get('origin'));
    return this.widgets.session(info, body.token);
  }

  @Get('avatar')
  async avatar(
    @Param({ schema: publicKeyParamsSchema }) p: { publicKey: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const ws = await this.prisma.workspace.findUnique({ where: { publicKey: p.publicKey }, include: { assistant: true } });
    const name = ws?.assistant?.avatarName;
    if (!name) throw notFound('No avatar.');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return new StreamableFile(createReadStream(avatarPath(this.config, name)), {
      type: name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
    });
  }
}
