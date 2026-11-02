import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { type Challenge, ErrorCode, type Me, type RegisterBody } from '@frontdesk/shared';
import { hmacHex, randomToken, safeEqualHex, sha256 } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { uuidv7 } from '../common/ids.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { MailQueue } from '../mail/mail.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { type IssuedTokens, SessionsService } from './sessions.service.js';

export const CODE_TTL_SEC = 10 * 60;
export const CODE_MAX_ATTEMPTS = 5;
const RESET_TTL_SEC = 60 * 60;

const codeExpired = () =>
  new AppError(400, ErrorCode.CODE_EXPIRED, 'This code has expired or was used too many times. Log in again.');

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(MailQueue) private readonly mail: MailQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates the user, their first workspace and the owner membership, then emails a login code. */
  async register(body: RegisterBody): Promise<Challenge> {
    const passwordHash = await hashPassword(body.password);
    const userId = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: body.email }, select: { id: true } });
      if (existing) {
        throw new AppError(409, ErrorCode.EMAIL_TAKEN, 'An account with this email already exists. Try logging in.');
      }
      const user = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash } });
      const workspace = await tx.workspace.create({ data: { name: body.workspaceName } });
      await tx.membership.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'owner' } });
      return user.id;
    });
    return this.challenge(userId, body.email);
  }

  /** Step 1: email + password. A correct password only earns an emailed code, never a session. */
  async login(email: string, password: string): Promise<Challenge> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(user?.passwordHash, password);
    if (!user || !ok) throw new AppError(401, ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect.');
    return this.challenge(user.id, user.email);
  }

  /** Step 2: the 6-digit code. Single use, 10 minutes, at most 5 tries. */
  async verifyCode(challengeId: string, code: string): Promise<IssuedTokens> {
    const row = await this.prisma.loginCode.findUnique({ where: { id: challengeId } });
    if (!row || row.usedAt || row.expiresAt <= new Date()) throw codeExpired();

    // Count the attempt first (conditionally), so parallel guesses can't exceed the limit.
    const { count } = await this.prisma.loginCode.updateMany({
      where: { id: row.id, usedAt: null, attempts: { lt: CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) throw codeExpired();

    if (!safeEqualHex(row.codeHash, this.hashCode(row.id, code))) {
      throw new AppError(400, ErrorCode.CODE_INVALID, 'That code isn’t right. Check the email and try again.', {
        code: 'That code isn’t right',
      });
    }
    const used = await this.prisma.loginCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count === 0) throw codeExpired();

    await this.prisma.user.updateMany({
      where: { id: row.userId, emailVerifiedAt: null },
      data: { emailVerifiedAt: new Date() },
    });
    return this.sessions.start(row.userId);
  }

  /** The login a resend request belongs to, if it is still in progress (recent and not completed). */
  async pendingLogin(challengeId: string): Promise<{ userId: string; email: string } | null> {
    const row = await this.prisma.loginCode.findUnique({ where: { id: challengeId }, include: { user: true } });
    if (!row || row.usedAt || row.createdAt.getTime() < Date.now() - 30 * 60 * 1000) return null;
    return { userId: row.userId, email: row.user.email };
  }

  /** Always succeeds from the caller's point of view, so it can't be used to find out who has an account. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return;
    const token = randomToken();
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_SEC * 1000) },
      }),
    ]);
    await this.mail.send(email, { kind: 'password_reset', token });
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await hashPassword(password);
    const userId = await this.prisma.$transaction(async (tx) => {
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
      if (!row || row.usedAt || row.expiresAt <= new Date()) {
        throw new AppError(400, ErrorCode.TOKEN_INVALID, 'This link is invalid or has expired. Ask for a new one.');
      }
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) throw new AppError(400, ErrorCode.TOKEN_INVALID, 'This link has already been used.');
      // Reaching the link proves the email address too.
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
      await tx.user.updateMany({ where: { id: row.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
      return row.userId;
    });
    await this.sessions.revokeAllForUser(userId); // log out everywhere after a reset
  }

  async me(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(401, ErrorCode.UNAUTHENTICATED, 'Please log in.');
    return { id: user.id, email: user.email, name: user.name };
  }

  private hashCode(challengeId: string, code: string): string {
    return hmacHex(this.config.CODE_SECRET, `${challengeId}:${code}`);
  }

  /** Issues a new code (older unused codes for this user stop working) and queues the email. */
  async challenge(userId: string, email: string): Promise<Challenge> {
    const id = uuidv7();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.$transaction([
      this.prisma.loginCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.loginCode.create({
        data: {
          id,
          userId,
          codeHash: this.hashCode(id, code),
          expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
        },
      }),
    ]);
    await this.mail.send(email, { kind: 'login_code', code });
    return { challengeId: id, expiresInSec: CODE_TTL_SEC };
  }
}
