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
import { HealthController } from './health/health.controller.js';
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

@Module({ controllers: [KnowledgeController], providers: [KnowledgeService] })
class KnowledgeModule {}

/** The HTTP API (src/main.ts). */
@Module({})
export class AppModule {
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forConfig(config), AuthModule, WorkspacesModule, BusinessModule, KnowledgeModule],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    };
  }
}
