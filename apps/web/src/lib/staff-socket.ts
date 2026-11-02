'use client';

import type { ChatMessage, ConversationSummary } from '@frontdesk/shared';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

export interface StaffHandlers {
  onConversation?: (c: ConversationSummary) => void;
  onMessage?: (e: { conversationId: string; message: ChatMessage }) => void;
  onHandoverRequested?: (c: ConversationSummary) => void;
}

/**
 * Live updates for one workspace. Same origin as the dashboard, so the httpOnly access cookie authenticates it; the
 * API checks membership before joining the workspace's room. Being connected is what makes you "online" for handover.
 */
export function useStaffSocket(workspaceId: string, handlers: StaffHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const socket: Socket = io('/staff', { path: '/api/socket.io', addTrailingSlash: false, withCredentials: true });
    const join = () => socket.emit('join', { workspaceId });
    socket.on('connect', join);
    socket.on('conversation', (c: ConversationSummary) => ref.current.onConversation?.(c));
    socket.on('message', (e: { conversationId: string; message: ChatMessage }) => ref.current.onMessage?.(e));
    socket.on('handover:requested', (c: ConversationSummary) => ref.current.onHandoverRequested?.(c));
    return () => {
      socket.disconnect();
    };
  }, [workspaceId]);
}
