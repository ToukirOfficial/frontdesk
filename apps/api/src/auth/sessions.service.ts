import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ErrorCode } from '@frontdesk/shared';
import { ACCESS_TTL_SEC, REFRESH_TTL_SEC } from '../common/cookies.js';
import { randomToken, safeEqualHex, sha256 } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { UUID_RE } from '../common/ids.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The access token carries only the user id; workspace roles are checked against the database per request. */
export interface AccessPayload {
  sub: string;
}

export interface IssuedTokens {
  userId: string;
  access: string;
  refresh: string;
}

const expired = () => new AppError(401, ErrorCode.SESSION_EXPIRED, 'Your session has ended. Please log in again.');

/**
 * Access token: short-lived JWT. Refresh token: `<id>.<secret>`, stored as SHA-256 of the secret and rotated on
 * every use. All rotations of one login share a familyId; presenting a refresh token that was already rotated
 * (a stolen copy, or a replay) revokes the whole family.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  /** New login: a new family. */
  start(userId: string): Promise<IssuedTokens> {
    return this.issue(userId, randomUUID());
  }

  async rotate(refreshToken: string | undefined): Promise<IssuedTokens> {
    const [id, secret] = (refreshToken ?? '').split('.');
    if (!id || !secret || !UUID_RE.test(id)) throw expired();

    const row = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (!row || !safeEqualHex(row.tokenHash, sha256(secret))) throw expired();

    if (row.revokedAt || row.replacedById) {
      // Reuse of a rotated token: someone else may hold this family. End all of it.
      await this.revokeFamily(row.familyId);
      throw expired();
    }
    if (row.expiresAt <= new Date()) throw expired();

    return this.issue(row.userId, row.familyId, row.id);
  }

  async revokeFamilyOf(refreshToken: string | undefined): Promise<void> {
    const id = (refreshToken ?? '').split('.')[0];
    if (!id || !UUID_RE.test(id)) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { id } });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async issue(userId: string, familyId: string, replacesId?: string): Promise<IssuedTokens> {
    const secret = randomToken();
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          userId,
          familyId,
          tokenHash: sha256(secret),
          expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
        },
      });
      if (replacesId) {
        // Conditional update: of two concurrent rotations of the same token, only one wins.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: replacesId, replacedById: null, revokedAt: null },
          data: { replacedById: created.id },
        });
        if (count === 0) throw expired();
      }
      return created;
    });
    const payload: AccessPayload = { sub: userId };
    const access = await this.jwt.signAsync(payload, { expiresIn: ACCESS_TTL_SEC });
    return { userId, access, refresh: `${row.id}.${secret}` };
  }
}
