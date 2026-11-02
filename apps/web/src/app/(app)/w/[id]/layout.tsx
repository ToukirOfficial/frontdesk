'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { WorkspaceProvider } from '@/components/session';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  return (
    <WorkspaceProvider id={id}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
