import { Inject, Injectable } from '@nestjs/common';
import {
  type AcceptInviteBody,
  type CreateInviteBody,
  ErrorCode,
  type Invite,
  type InvitePreview,
} from '@frontdesk/shared';
import type { WorkspaceAuth } from '../common/auth.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { MailQueue } from '../mail/mail.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';

const INVITE_TTL_SEC = 7 * 24 * 60 * 60;
const invalid = () => new AppError(400, ErrorCode.TOKEN_INVALID, 'This invite is invalid or has expired.');

@Injectable()
export class InvitesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailQueue) private readonly mail: MailQueue,
  ) {}

  async list(auth: WorkspaceAuth): Promise<Invite[]> {
    const rows = await this.prisma.invite.findMany({
      where: { workspaceId: auth.workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /** Owner or admin (guard). A new invite to the same email replaces the old one. */
  async create(auth: WorkspaceAuth, body: CreateInviteBody): Promise<Invite> {
    const member = await this.prisma.membership.findFirst({
      where: { workspaceId: auth.workspaceId, user: { email: body.email } },
      select: { id: true },
    });
    if (member) throw new AppError(409, ErrorCode.ALREADY_MEMBER, 'This person is already in the workspace.');

    const token = randomToken();
    const { invite, workspaceName } = await this.prisma.$transaction(async (tx) => {
      await tx.invite.deleteMany({ where: { workspaceId: auth.workspaceId, email: body.email, acceptedAt: null } });
      const invite = await tx.invite.create({
        data: {
          workspaceId: auth.workspaceId,
          email: body.email,
          role: body.role,
          tokenHash: sha256(token),
          invitedById: auth.userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_SEC * 1000),
        },
      });
      const ws = await tx.workspace.findUniqueOrThrow({ where: { id: auth.workspaceId }, select: { name: true } });
      return { invite, workspaceName: ws.name };
    });
    await this.mail.send(body.email, { kind: 'invite', token, workspaceName, role: body.role });
    return this.toDto(invite);
  }

  async revoke(auth: WorkspaceAuth, inviteId: string): Promise<void> {
    const { count } = await this.prisma.invite.deleteMany({
      where: { id: inviteId, workspaceId: auth.workspaceId, acceptedAt: null },
    });
    if (count === 0) throw notFound('Invite not found.');
  }

  async preview(token: string): Promise<InvitePreview> {
    const invite = await this.findValid(token);
    const user = await this.prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } });
    return {
      workspaceName: invite.workspace.name,
      email: invite.email,
      role: invite.role === 'admin' ? 'admin' : 'staff',
      hasAccount: user !== null,
    };
  }

  /**
   * The emailed token proves the address. New people choose a name and password; people who already have an
   * account confirm with their password. Returns the user id so the controller can start a session.
   */
  async accept(body: AcceptInviteBody): Promise<{ userId: string; workspaceId: string }> {
    const invite = await this.findValid(body.token);
    const existing = await this.prisma.user.findUnique({ where: { email: invite.email } });

    if (existing) {
      if (!(await verifyPassword(existing.passwordHash, body.password))) {
        throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'That password isn’t right.', {
          password: 'That password isn’t right',
        });
      }
    } else {
      const fields: Record<string, string> = {};
      if (!body.name) fields.name = 'Enter your name';
      if (body.password.length < 10) fields.password = 'Use at least 10 characters';
      if (Object.keys(fields).length) {
        throw new AppError(400, ErrorCode.VALIDATION_FAILED, 'Some fields need attention.', fields);
      }
    }
    const passwordHash = existing ? null : await hashPassword(body.password);

    const userId = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (count === 0) throw invalid();
      const user =
        existing ??
        (await tx.user.create({
          data: { email: invite.email, name: body.name ?? '', passwordHash: passwordHash!, emailVerifiedAt: new Date() },
        }));
      await tx.membership.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
        create: { workspaceId: invite.workspaceId, userId: user.id, role: invite.role },
        update: {},
      });
      return user.id;
    });
    return { userId, workspaceId: invite.workspaceId };
  }

  private async findValid(token: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: { select: { name: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) throw invalid();
    return invite;
  }

  private toDto(r: { id: string; email: string; role: string; expiresAt: Date; createdAt: Date }): Invite {
    return {
      id: r.id,
      email: r.email,
      role: r.role === 'admin' ? 'admin' : 'staff',
      expiresAt: r.expiresAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
