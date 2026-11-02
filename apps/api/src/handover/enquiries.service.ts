import { Inject, Injectable } from '@nestjs/common';
import { consentText, type EnquiryBody, ErrorCode } from '@frontdesk/shared';
import { AppError } from '../common/errors.js';
import { MailQueue } from '../mail/mail.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type WidgetInfo, WidgetService } from '../chat/widget.service.js';
import { ConversationsService } from './conversations.service.js';

const badToken = () => new AppError(401, ErrorCode.UNAUTHENTICATED, 'Your chat session has expired. Reload the page.');

@Injectable()
export class EnquiriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WidgetService) private readonly widgets: WidgetService,
    @Inject(MailQueue) private readonly mail: MailQueue,
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
  ) {}

  /** Stores the enquiry with the consent wording, emails it to the business (queued), and notes it in the chat. */
  async create(info: WidgetInfo, body: EnquiryBody): Promise<void> {
    const claims = await this.widgets.verify(body.token);
    if (!claims || claims.wid !== info.workspaceId) throw badToken();
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: claims.cid, workspaceId: info.workspaceId },
      select: { id: true },
    });
    if (!conversation) throw badToken();

    await this.prisma.enquiry.create({
      data: {
        workspaceId: info.workspaceId,
        conversationId: conversation.id,
        name: body.name,
        email: body.email || null,
        phone: body.phone || null,
        need: body.need,
        consentText: consentText(info.name),
        consentAt: new Date(),
        emailedAt: new Date(),
      },
    });
    for (const to of await this.recipients(info.workspaceId)) {
      await this.mail.send(to, {
        kind: 'enquiry',
        workspaceName: info.name,
        workspaceId: info.workspaceId,
        name: body.name,
        email: body.email,
        phone: body.phone,
        need: body.need,
      });
    }
    await this.conversations.system(info.workspaceId, conversation.id, 'Thanks, your message has been passed to the team. They’ll get back to you.');
    await this.conversations.broadcast(info.workspaceId, conversation.id);
  }

  /**
   * Owners and admins, whose addresses are proven by every login (each login needs an emailed code). The business
   * contact email is used too, but only when it belongs to a member: an address typed into the dashboard is never
   * mailed on its own, or anyone could sign up and use this server to send messages to strangers.
   */
  private async recipients(workspaceId: string): Promise<string[]> {
    const [business, members] = await Promise.all([
      this.prisma.businessProfile.findUnique({ where: { workspaceId }, select: { email: true } }),
      this.prisma.membership.findMany({ where: { workspaceId }, select: { role: true, user: { select: { email: true } } } }),
    ]);
    const to = new Set(members.filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.user.email));
    const contact = business?.email?.toLowerCase();
    if (contact && members.some((m) => m.user.email === contact)) to.add(contact);
    return [...to];
  }
}
