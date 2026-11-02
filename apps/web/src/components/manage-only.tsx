'use client';

import { PageHeader } from '@/components/app-shell';
import { canManage, useWorkspace } from '@/components/session';
import { EmptyState } from '@/components/states';

/** Pages for owners and admins. The API enforces this; the page just explains it instead of showing errors. */
export function ManageOnly({ title, children }: { title: string; children: React.ReactNode }) {
  const { workspace } = useWorkspace();
  if (canManage(workspace)) return <>{children}</>;
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Only owners and admins can change this" />
    </>
  );
}
