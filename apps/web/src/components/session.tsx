'use client';

import type { Me, Workspace } from '@frontdesk/shared';
import { createContext, useContext } from 'react';
import { ErrorState, LoadingState } from '@/components/states';
import { useApi } from '@/lib/use-api';

const MeContext = createContext<{ me: Me; reload: () => void } | null>(null);

/** Loads the current user once for the whole dashboard. A 401 redirects to /login (see lib/api). */
export function MeProvider({ children }: { children: React.ReactNode }) {
  const { data, error, reload } = useApi<Me>('/auth/me');
  if (!data) return error ? <ErrorState error={error} onRetry={reload} /> : <LoadingState />;
  return <MeContext.Provider value={{ me: data, reload }}>{children}</MeContext.Provider>;
}

export const useMe = () => {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe outside MeProvider');
  return ctx;
};

const WorkspaceContext = createContext<{ workspace: Workspace; reload: () => void } | null>(null);

/** The workspace in the URL, with the current user's role in it. The API decides; this only shapes the UI. */
export function WorkspaceProvider({ id, children }: { id: string; children: React.ReactNode }) {
  const { data, error, reload } = useApi<Workspace>(`/workspaces/${id}`);
  if (!data || data.id !== id) return error ? <ErrorState error={error} onRetry={reload} /> : <LoadingState />;
  return <WorkspaceContext.Provider value={{ workspace: data, reload }}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace outside WorkspaceProvider');
  return ctx;
};

/** Owner and admin manage settings and the team; staff handle conversations. */
export const canManage = (w: Workspace) => w.role === 'owner' || w.role === 'admin';
