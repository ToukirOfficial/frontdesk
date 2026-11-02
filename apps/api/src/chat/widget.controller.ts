import { createReadStream } from 'node:fs';
import { Body, Controller, Delete, Get, Inject, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import {
  type BookBody,
  type DemoKeyBody,
  demoKeyBodySchema,
  type DemoKeyInfo,
  demoKeyInfoSchema,
  ErrorCode,
  bookBodySchema,
  bookingServicesSchema,
  bookResultSchema,
  type EnquiryBody,
  enquiryBodySchema,
  okSchema,
  slotsQuerySchema,
  slotsSchema,
  type Slots,
  visitorTokenBodySchema,
  publicKeyParamsSchema,
  type WidgetConfig,
  widgetConfigSchema,
  type WidgetSession,
  widgetSessionBodySchema,
  widgetSessionSchema,
} from '@frontdesk/shared';
import type { Request, Response } from 'express';
import { Public } from '../common/auth.js';
import { AppError, notFound } from '../common/errors.js';
import { AiResolver } from '../ai/ai-resolver.js';
import { pingProvider } from '../ai/ai-settings.service.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Returns } from '../common/schema.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BookingService } from '../booking/booking.service.js';
import { EnquiriesService } from '../handover/enquiries.service.js';
import { UsageService } from '../insights/usage.service.js';
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
    @Inject(EnquiriesService) private readonly enquiries: EnquiriesService,
    @Inject(BookingService) private readonly booking: BookingService,
    @Inject(UsageService) private readonly usage: UsageService,
    @Inject(AiResolver) private readonly ai: AiResolver,
  ) {}

  /**
   * Demo only: "try with your own key". The key is tested with one tiny request, then stored encrypted against this
   * visitor's conversation for 24 hours. It is never returned (only its last 4 characters) and never logged.
   */
  @Post('demo-key')
  @Returns(demoKeyInfoSchema, 201)
  async setDemoKey(
    @Param({ schema: publicKeyParamsSchema }) p: { publicKey: string },
    @Body({ schema: demoKeyBodySchema }) body: DemoKeyBody,
    @Req() req: Request,
  ): Promise<DemoKeyInfo> {
    await this.limiter.hit(`demo-key:ip:${req.ip}`, 5, 60 * 60, 'You’ve tried several keys already. Please try again later.');
    const conversationId = await this.demoConversation(p.publicKey, body.token, req);
    const value = { provider: body.provider, model: body.model, apiKey: body.apiKey };
    const test = await pingProvider(this.ai.build(this.ai.dashboardSpec(value)));
    if (!test.ok) throw new AppError(400, ErrorCode.AI_KEY_REJECTED, test.message, { apiKey: test.message });
    await this.ai.setDemoKey(conversationId, value);
    const info = await this.ai.demoKeyInfo(conversationId);
    if (!info) throw new AppError(500, ErrorCode.INTERNAL, 'Couldn’t save the key.');
    return info;
  }

  @Delete('demo-key')
  @Returns(okSchema)
  async deleteDemoKey(
    @Param({ schema: publicKeyParamsSchema }) p: { publicKey: string },
    @Body({ schema: visitorTokenBodySchema }) body: { token: string },
    @Req() req: Request,
  ) {
    await this.limiter.hit(`demo-key-delete:ip:${req.ip}`, 30, 60 * 60);
    await this.ai.deleteDemoKey(await this.demoConversation(p.publicKey, body.token, req));
    return { ok: true } as const;
  }

  /** The visitor's demo conversation, from their visitor token. Anything but the demo clinic is "not found". */
  private async demoConversation(publicKey: string, token: string, req: Request): Promise<string> {
    const info = await this.widgets.byKey(publicKey);
    if (!this.config.DEMO_MODE || !info.isDemo) throw notFound();
    this.widgets.checkOrigin(info, req.get('origin'));
    const claims = await this.widgets.verify(token);
    if (claims?.wid !== info.workspaceId) throw new AppError(401, ErrorCode.TOKEN_INVALID, 'Your chat session has expired. Reload the page.');
    const conversation = await this.prisma.conversation.findFirst({ where: { id: claims.cid, workspaceId: info.workspaceId }, select: { id: true } });
    if (!conversation) throw new AppError(401, ErrorCode.TOKEN_INVALID, 'Your chat session has expired. Reload the page.');
    return conversation.id;
  }

  /** Leave a message. Works even when the assistant is switched off (e.g. the monthly cap is reached). */
  @Post('enquiry')
  @Returns(okSchema, 201)
  async enquiry(
    @Param({ schema: publicKeyParamsSchema }) p: { publicKey: string },
    @Body({ schema: enquiryBodySchema }) body: EnquiryBody,
    @Req() req: Request,
  ) {
    await this.limiter.hit(`enquiry:ip:${req.ip}`, 5, 60 * 60, 'You’ve sent several messages already. Please try again later.');
    const info = await this.widgets.byKey(p.publicKey);
    this.widgets.checkOrigin(info, req.get('origin'));
    await this.limiter.hit(`enquiry:ws:${info.workspaceId}`, 100, 60 * 60);
    await this.enquiries.create(info, body);
    return { ok: true } as const;
  }

  /** POST so the visitor token stays out of URLs and logs. */
  @Post('booking/services')
  @Returns(bookingServicesSchema)
  async services(
    @Param({ schema: publicKeyParamsSchema }) p: { publicKey: string },
    @Body({ schema: visitorTokenBodySchema }) body: { token: string },
    @Req() req: Request,
  ) {
    await this.limiter.hit(`booking-read:ip:${req.ip}`, 30, 60);
    const info = await this.widgets.byKey(p.publicKey);
    this.widgets.checkOrigin(info, req.get('origin'));
    return this.booking.services(info, body.token);
  }

  @Post('booking/slots')
  @Returns(slotsSchema)
  async slots(
    @Param({ schema: publicKeyParamsSchema }) p: { publicKey: string },
    @Body({ schema: slotsQuerySchema }) body: { token: string; serviceId: string; from: string; to: string },
    @Req() req: Request,
  ): Promise<Slots> {
    await this.limiter.hit(`booking-read:ip:${req.ip}`, 30, 60);
    const info = await this.widgets.byKey(p.publicKey);
    this.widgets.checkOrigin(info, req.get('origin'));
    return this.booking.slots(info, body);
  }

  @Post('booking')
  @Returns(bookResultSchema, 201)
  async book(
    @Param({ schema: publicKeyParamsSchema }) p: { publicKey: string },
    @Body({ schema: bookBodySchema }) body: BookBody,
    @Req() req: Request,
  ) {
    await this.limiter.hit(`booking:ip:${req.ip}`, 5, 60 * 60, 'You’ve made several bookings already. Please contact the business directly.');
    const info = await this.widgets.byKey(p.publicKey);
    this.widgets.checkOrigin(info, req.get('origin'));
    return this.booking.book(info, body);
  }

  @Get('config')
  @Returns(widgetConfigSchema)
  async getConfig(@Param({ schema: publicKeyParamsSchema }) p: { publicKey: string }, @Req() req: Request): Promise<WidgetConfig> {
    await this.limiter.hit(`widget-config:ip:${req.ip}`, 120, 60);
    const info = await this.widgets.byKey(p.publicKey);
    this.widgets.checkOrigin(info, req.get('origin'));
    return await this.widgets.config(info, (await this.usage.capReached(info.workspaceId)) ? 'message' : 'chat');
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
