import { z } from 'zod';
import { emailSchema, instantSchema, nameSchema, tokenSchema } from './common.js';

export const ROLES = ['owner', 'admin', 'staff'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;
/** Roles that can be given through an invite or a role change. Ownership is never handed out this way. */
export const assignableRoleSchema = z.enum(['admin', 'staff']);
export type AssignableRole = z.infer<typeof assignableRoleSchema>;

export const workspaceParamsSchema = z.object({ workspaceId: z.uuid() });
export const memberParamsSchema = z.object({ workspaceId: z.uuid(), userId: z.uuid() });
export const inviteParamsSchema = z.object({ workspaceId: z.uuid(), inviteId: z.uuid() });

export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: roleSchema,
  isDemo: z.boolean(),
  createdAt: instantSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const workspaceListSchema = z.object({ items: z.array(workspaceSchema) });
export type WorkspaceList = z.infer<typeof workspaceListSchema>;

export const createWorkspaceBodySchema = z.object({ name: z.string().trim().min(2).max(100) });
export const updateWorkspaceBodySchema = z.object({ name: z.string().trim().min(2).max(100) });
export type WorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;

export const memberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  joinedAt: instantSchema,
});
export type Member = z.infer<typeof memberSchema>;
export const memberListSchema = z.object({ items: z.array(memberSchema) });
export type MemberList = z.infer<typeof memberListSchema>;

export const updateMemberBodySchema = z.object({ role: assignableRoleSchema });

export const createInviteBodySchema = z.object({ email: emailSchema, role: assignableRoleSchema });
export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;

export const inviteSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: assignableRoleSchema,
  expiresAt: instantSchema,
  createdAt: instantSchema,
});
export type Invite = z.infer<typeof inviteSchema>;
export const inviteListSchema = z.object({ items: z.array(inviteSchema) });
export type InviteList = z.infer<typeof inviteListSchema>;

/** What the invite page shows before the person accepts. */
export const invitePreviewSchema = z.object({
  workspaceName: z.string(),
  email: z.string(),
  role: assignableRoleSchema,
  hasAccount: z.boolean(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
export const inviteTokenParamsSchema = z.object({ token: tokenSchema });

/** New people choose a name and password; people with an account confirm with their password. */
export const acceptInviteBodySchema = z.object({
  token: tokenSchema,
  name: nameSchema.optional(),
  password: z.string().min(1).max(200),
});
export type AcceptInviteBody = z.infer<typeof acceptInviteBodySchema>;
export const acceptInviteResultSchema = z.object({ workspaceId: z.uuid() });
