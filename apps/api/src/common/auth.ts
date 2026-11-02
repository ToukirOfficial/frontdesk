import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@frontdesk/shared';
import type { Request } from 'express';

/**
 * Who is calling. `workspaceId` and `role` are only set on workspace routes, after the guard has checked that the
 * user is a member of the workspace in the URL. Services take the workspace id from here, never from the body.
 */
export interface UserAuth {
  userId: string;
}
export interface WorkspaceAuth extends UserAuth {
  workspaceId: string;
  role: Role;
}

export type AuthedRequest = Request & { auth?: UserAuth | WorkspaceAuth };

export const IS_PUBLIC = 'frontdesk:public';
export const LOGGED_IN = 'frontdesk:logged-in';
export const ROLES = 'frontdesk:roles';

/** Anyone, no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Any logged-in user; not tied to a workspace. */
export const LoggedIn = () => SetMetadata(LOGGED_IN, true);
/** A member of the `:workspaceId` in the URL with one of these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);
/** Every role: any member of the workspace. */
export const AnyMember = () => Roles('owner', 'admin', 'staff');

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): UserAuth => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new Error('Auth() used on a route without authentication');
  return auth;
});

export const Member = createParamDecorator((_: unknown, ctx: ExecutionContext): WorkspaceAuth => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth || !('workspaceId' in auth)) throw new Error('Member() used on a route without @Roles()');
  return auth;
});
