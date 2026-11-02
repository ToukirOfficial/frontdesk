import { Injectable } from '@nestjs/common';
import type { ChatMessage, ConversationSummary, VisitorServerEvents } from '@frontdesk/shared';
import type { Namespace } from 'socket.io';

export const conversationRoom = (conversationId: string) => `conv:${conversationId}`;
export const staffRoom = (workspaceId: string) => `staff:${workspaceId}`;

/**
 * Emits to visitors and staff from anywhere (gateways and HTTP handlers). Rooms are shared across API instances
 * through the Redis adapter, so it doesn't matter which instance a socket is connected to.
 */
@Injectable()
export class RealtimeService {
  private visitors?: Namespace;
  private staff?: Namespace;

  setVisitorNamespace(ns: Namespace): void {
    this.visitors = ns;
  }

  setStaffNamespace(ns: Namespace): void {
    this.staff = ns;
  }

  toVisitor<E extends keyof VisitorServerEvents>(conversationId: string, event: E, ...args: Parameters<VisitorServerEvents[E]>): void {
    this.visitors?.to(conversationRoom(conversationId)).emit(event, ...args);
  }

  staffMessage(workspaceId: string, conversationId: string, message: ChatMessage): void {
    this.staff?.to(staffRoom(workspaceId)).emit('message', { conversationId, message });
  }

  staffConversation(workspaceId: string, summary: ConversationSummary, event: 'conversation' | 'handover:requested' = 'conversation'): void {
    this.staff?.to(staffRoom(workspaceId)).emit(event, summary);
  }

  /**
   * Takes people out of a workspace's live room at once: one user (removed or left) or everyone (workspace deleted).
   * They can't rejoin, because joining checks membership.
   */
  async removeStaff(workspaceId: string, userId?: string): Promise<void> {
    if (!this.staff) return;
    for (const s of await this.staff.in(staffRoom(workspaceId)).fetchSockets()) {
      if (userId === undefined || (s.data as { userId?: string } | undefined)?.userId === userId) s.leave(staffRoom(workspaceId));
    }
  }

  /** Is anyone from this workspace on the conversations dashboard right now (on any API instance)? */
  async staffOnline(workspaceId: string): Promise<boolean> {
    if (!this.staff) return false;
    const sockets = await this.staff.in(staffRoom(workspaceId)).fetchSockets();
    return sockets.length > 0;
  }
}
