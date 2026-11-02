import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller.js';
import { BusinessController } from './business/business.controller.js';
import { BusinessService } from './business/business.service.js';
import { KnowledgeController } from './knowledge/knowledge.controller.js';
import { KnowledgeService } from './knowledge/knowledge.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { SessionsService } from './auth/sessions.service.js';
import type { AppConfig } from './config.js';
import { CoreModule } from './core.module.js';
import { AiSettingsController } from './ai/ai-settings.controller.js';
import { AiSettingsService } from './ai/ai-settings.service.js';
import { createEmbedder, EMBEDDER } from './ai/embeddings.js';
import { AssistantService } from './chat/assistant.service.js';
import { VisitorGateway } from './chat/visitor.gateway.js';
import { WidgetController } from './chat/widget.controller.js';
import { WidgetService } from './chat/widget.service.js';
import { BookingService } from './booking/booking.service.js';
import { ConversationsController } from './handover/conversations.controller.js';
import { ConversationsService } from './handover/conversations.service.js';
import { EnquiriesService } from './handover/enquiries.service.js';
import { StaffGateway } from './handover/staff.gateway.js';
import { InsightsController } from './insights/insights.controller.js';
import { UsageService } from './insights/usage.service.js';
import { APP_CONFIG } from './config.js';
import { VectorStore } from './knowledge/vector-store.js';
import { HealthController } from './health/health.controller.js';
import { DemoController } from './demo/demo.controller.js';
import { DemoService } from './demo/demo.service.js';
import { InvitesController } from './workspaces/invites.controller.js';
import { InvitesService } from './workspaces/invites.service.js';
import { WorkspacesController } from './workspaces/workspaces.controller.js';
import { WorkspacesService } from './workspaces/workspaces.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionsService],
  exports: [SessionsService],
})
class AuthModule {}

@Module({
  imports: [AuthModule],
  controllers: [WorkspacesController, InvitesController],
  providers: [WorkspacesService, InvitesService],
})
class WorkspacesModule {}

@Module({ controllers: [BusinessController], providers: [BusinessService], exports: [BusinessService] })
class BusinessModule {}

@Module({ controllers: [AiSettingsController], providers: [AiSettingsService] })
class AiSettingsModule {}

@Module({ controllers: [KnowledgeController], providers: [KnowledgeService], exports: [KnowledgeService] })
class KnowledgeModule {}

@Module({
  imports: [KnowledgeModule],
  controllers: [WidgetController, ConversationsController, InsightsController],
  providers: [
    UsageService,
    WidgetService,
    ConversationsService,
    EnquiriesService,
    BookingService,
    StaffGateway,
    AssistantService,
    VisitorGateway,
    VectorStore,
    { provide: EMBEDDER, useFactory: createEmbedder, inject: [APP_CONFIG] },
  ],
  exports: [WidgetService],
})
class ChatModule {}

/** The HTTP API (src/main.ts). */
@Module({})
export class AppModule {
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forConfig(config), AuthModule, WorkspacesModule, BusinessModule, AiSettingsModule, KnowledgeModule, ChatModule],
      controllers: [HealthController, DemoController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }, DemoService],
    };
  }
}
