import { Inject, Injectable } from '@nestjs/common';
import { type BookBody, ErrorCode, type Slots } from '@frontdesk/shared';
import { decrypt } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ConversationsService } from '../handover/conversations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { type WidgetInfo, WidgetService } from '../chat/widget.service.js';
import { slotwise, type SlotwiseConnection } from './slotwise.client.js';

const MAX_RANGE_DAYS = 14;
const ukDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const notConnected = () => new AppError(400, ErrorCode.BOOKING_UNAVAILABLE, 'Online booking isn’t set up for this business.');

/** Booking inside the chat, through the workspace's own Slotwise connection. */
@Injectable()
export class BookingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(WidgetService) private readonly widgets: WidgetService,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async services(info: WidgetInfo, token: string) {
    await this.visitor(info, token);
    const key = `slotwise-services:${info.workspaceId}`;
    const cached = await this.redis.getJson<Awaited<ReturnType<typeof slotwise.services>>>(key);
    if (cached) return { items: cached };
    const items = await slotwise.services(await this.connection(info.workspaceId));
    await this.redis.setJson(key, items, 300);
    return { items };
  }

  async slots(info: WidgetInfo, q: { token: string; serviceId: string; from: string; to: string }): Promise<Slots> {
    await this.visitor(info, q.token);
    const days = (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000;
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (days < 0 || days >= MAX_RANGE_DAYS || q.from < yesterday) {
      throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Choose up to two weeks, from today.');
    }
    // Short cache: keeps busy chats well under Slotwise's 60 requests a minute per key.
    const key = `slotwise-slots:${info.workspaceId}:${q.serviceId}:${q.from}:${q.to}`;
    const cached = await this.redis.getJson<Slots>(key);
    if (cached) return cached;
    const slots = await slotwise.availability(await this.connection(info.workspaceId), q.serviceId, q.from, q.to);
    await this.redis.setJson(key, slots, 30);
    return slots;
  }

  async book(info: WidgetInfo, body: BookBody): Promise<{ startsAt: string; serviceName: string }> {
    const conversationId = await this.visitor(info, body.token);
    const connection = await this.connection(info.workspaceId);
    const service = (await slotwise.services(connection)).find((s) => s.id === body.serviceId);
    if (!service) throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'That service isn’t available.');
    const booked = await slotwise.book(
      connection,
      { serviceId: body.serviceId, startsAt: body.startsAt, customer: { name: body.name, email: body.email, phone: body.phone } },
      body.idempotencyKey,
    );
    // Cached free times expire within 30 seconds; Slotwise itself refuses a slot that's already taken.
    const when = ukDateTime.format(new Date(booked.startsAt));
    await this.conversations.system(info.workspaceId, conversationId, `Booked: ${service.name}, ${when} (UK time). A confirmation email is on its way.`);
    return { startsAt: booked.startsAt, serviceName: service.name };
  }

  private async visitor(info: WidgetInfo, token: string): Promise<string> {
    const claims = await this.widgets.verify(token);
    if (!claims || claims.wid !== info.workspaceId) {
      throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Your chat session has expired. Reload the page.');
    }
    return claims.cid;
  }

  private async connection(workspaceId: string): Promise<SlotwiseConnection> {
    const row = await this.prisma.assistantSettings.findUnique({ where: { workspaceId } });
    if (!row?.slotwiseBaseUrl || !row.slotwiseKeyCipher) throw notConnected();
    return {
      baseUrl: row.slotwiseBaseUrl,
      apiKey: decrypt(row.slotwiseKeyCipher, this.config.ENCRYPTION_KEY),
      allowHttp: this.config.NODE_ENV !== 'production',
      allowPrivate: this.config.ALLOW_PRIVATE_URLS,
    };
  }
}
