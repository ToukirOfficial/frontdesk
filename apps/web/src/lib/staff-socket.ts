'use client';

import type { ChatMessage, ConversationSummary } from '@frontdesk/shared';
import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';

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
    // The server closes the socket when the 15-minute login expires. Refresh the session (api() does that on a
    // 401, or sends you to log in) and connect again with the new cookie.
    let closed = false;
    socket.on('disconnect', (reason) => {
      if (reason !== 'io server disconnect' || closed) return;
      setTimeout(() => {
        if (closed) return;
        api('/auth/me')
          .then(() => !closed && socket.connect())
          .catch(() => undefined);
      }, 1000);
    });
    return () => {
      closed = true;
      socket.disconnect();
    };
  }, [workspaceId]);
}
