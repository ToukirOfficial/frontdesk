import { Inject, Injectable } from '@nestjs/common';
import { type AssignableRole, type Member, type Workspace } from '@frontdesk/shared';
import type { WorkspaceAuth } from '../common/auth.js';
import { forbidden, notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class WorkspacesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<Workspace[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
      isDemo: m.workspace.isDemo,
      createdAt: m.workspace.createdAt.toISOString(),
    }));
  }

  async create(userId: string, name: string): Promise<Workspace> {
    const workspace = await this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({ data: { name } });
      await tx.membership.create({ data: { workspaceId: ws.id, userId, role: 'owner' } });
      return ws;
    });
    return { id: workspace.id, name: workspace.name, role: 'owner', isDemo: false, createdAt: workspace.createdAt.toISOString() };
  }

  async get(auth: WorkspaceAuth): Promise<Workspace> {
    const ws = await this.prisma.workspace.findUnique({ where: { id: auth.workspaceId } });
    if (!ws) throw notFound('Workspace not found.');
    return { id: ws.id, name: ws.name, role: auth.role, isDemo: ws.isDemo, createdAt: ws.createdAt.toISOString() };
  }

  async rename(auth: WorkspaceAuth, name: string): Promise<Workspace> {
    await this.prisma.workspace.update({ where: { id: auth.workspaceId }, data: { name } });
    return this.get(auth);
  }

  /** Owner only (checked by the guard). Everything in the workspace goes with it (cascade). */
  async remove(auth: WorkspaceAuth): Promise<void> {
    await this.prisma.workspace.delete({ where: { id: auth.workspaceId } });
  }

  async members(auth: WorkspaceAuth): Promise<Member[]> {
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId: auth.workspaceId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  /** Owner only (guard). The owner's own role can't change: ownership isn't handed over this way. */
  async changeRole(auth: WorkspaceAuth, userId: string, role: AssignableRole): Promise<Member> {
    const target = await this.membership(auth.workspaceId, userId);
    if (target.role === 'owner') throw forbidden('The owner’s role can’t be changed.');
    await this.prisma.membership.update({ where: { id: target.id }, data: { role } });
    const members = await this.members(auth);
    const updated = members.find((m) => m.userId === userId);
    if (!updated) throw notFound('Member not found.');
    return updated;
  }

  /**
   * Who can remove whom: anyone except the owner can leave; the owner can remove anyone else; an admin can
   * remove staff. The owner can't leave (they delete the workspace instead).
   */
  async removeMember(auth: WorkspaceAuth, userId: string): Promise<void> {
    const target = await this.membership(auth.workspaceId, userId);
    const self = userId === auth.userId;
    if (target.role === 'owner') throw forbidden('The owner can’t be removed. Delete the workspace instead.');
    const allowed = self || auth.role === 'owner' || (auth.role === 'admin' && target.role === 'staff');
    if (!allowed) throw forbidden();
    await this.prisma.membership.delete({ where: { id: target.id } });
  }

  private async membership(workspaceId: string, userId: string) {
    const row = await this.prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } });
    if (!row) throw notFound('Member not found.');
    return row;
  }
}
