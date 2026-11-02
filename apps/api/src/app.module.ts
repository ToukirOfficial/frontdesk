import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth/auth.controller.js';
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

/** The HTTP API (src/main.ts). */
@Module({})
export class AppModule {
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forConfig(config), AuthModule, WorkspacesModule],
      controllers: [HealthController],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    };
  }
}
