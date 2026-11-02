import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  type ConversationDetail,
  conversationDetailSchema,
  type ConversationList,
  conversationListSchema,
  conversationParamsSchema,
  type ConversationSummary,
  conversationSummarySchema,
  chatMessageSchema,
  conversationListQuerySchema,
  staffReplyBodySchema,
  workspaceParamsSchema,
} from '@frontdesk/shared';
import { AnyMember, Member, type WorkspaceAuth } from '../common/auth.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Returns } from '../common/schema.js';
import { ConversationsService } from './conversations.service.js';

/** Every member (owner, admin, staff) can see conversations and take them over. */
@Controller('workspaces/:workspaceId/conversations')
@AnyMember()
export class ConversationsController {
  constructor(
    @Inject(ConversationsService) private readonly conversations: ConversationsService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Get()
  @Returns(conversationListSchema)
  list(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Query({ schema: conversationListQuerySchema }) q: { cursor?: string; q?: string },
    @Member() auth: WorkspaceAuth,
  ): Promise<ConversationList> {
    return this.conversations.list(auth, q.cursor, q.q);
  }

  @Get(':conversationId')
  @Returns(conversationDetailSchema)
  detail(@Param({ schema: conversationParamsSchema }) p: { conversationId: string }, @Member() auth: WorkspaceAuth): Promise<ConversationDetail> {
    return this.conversations.detail(auth, p.conversationId);
  }

  @Post(':conversationId/takeover')
  @Returns(conversationSummarySchema)
  takeover(@Param({ schema: conversationParamsSchema }) p: { conversationId: string }, @Member() auth: WorkspaceAuth): Promise<ConversationSummary> {
    return this.conversations.takeover(auth, p.conversationId);
  }

  @Post(':conversationId/handback')
  @Returns(conversationSummarySchema)
  handback(@Param({ schema: conversationParamsSchema }) p: { conversationId: string }, @Member() auth: WorkspaceAuth): Promise<ConversationSummary> {
    return this.conversations.handback(auth, p.conversationId);
  }

  @Post(':conversationId/messages')
  @Returns(chatMessageSchema, 201)
  async reply(
    @Param({ schema: conversationParamsSchema }) p: { conversationId: string },
    @Member() auth: WorkspaceAuth,
    @Body({ schema: staffReplyBodySchema }) body: { text: string },
  ) {
    await this.limiter.hit(`staff-reply:user:${auth.userId}`, 60, 60);
    return this.conversations.reply(auth, p.conversationId, body.text);
  }
}
