'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app-shell';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { canManage, useMe, useWorkspace } from '@/components/session';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, errorMessage } from '@/lib/api';
import { useSubmit } from '@/lib/forms';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', staff: 'Staff' } as const;

function RenameCard() {
  const { workspace, reload } = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const { pending, formError, fields, run } = useSubmit();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api(`/workspaces/${workspace.id}`, { method: 'PATCH', body: { name } }));
    if (ok) {
      toast.success('Workspace renamed');
      reload();
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Workspace name</h2>
        </CardTitle>
        <CardDescription>Shown to your team. Visitors see the business name you set later.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form onSubmit={save} className="grid max-w-md gap-4">
          <FormError message={formError} />
          <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
          <Button type="submit" className="w-fit" disabled={pending || name.trim() === workspace.name}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </Form>
      </CardContent>
    </Card>
  );
}

function DangerCard() {
  const router = useRouter();
  const { me } = useMe();
  const { workspace } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const isOwner = workspace.role === 'owner';

  const act = async () => {
    setBusy(true);
    try {
      await api(isOwner ? `/workspaces/${workspace.id}` : `/workspaces/${workspace.id}/members/${me.id}`, {
        method: 'DELETE',
      });
      router.replace('/w?new=1');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle>
          <h2>{isOwner ? 'Delete workspace' : 'Leave workspace'}</h2>
        </CardTitle>
        <CardDescription>
          {isOwner
            ? 'Deletes the workspace and everything in it for everyone. This can’t be undone.'
            : 'You’ll lose access until someone invites you again.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={busy}>
              {isOwner ? 'Delete workspace' : 'Leave workspace'}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{isOwner ? `Delete ${workspace.name}?` : `Leave ${workspace.name}?`}</AlertDialogTitle>
              <AlertDialogDescription>
                {isOwner ? 'Everything in this workspace will be deleted. This can’t be undone.' : 'You can rejoin only with a new invite.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={act}>{isOwner ? 'Delete' : 'Leave'}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const { workspace } = useWorkspace();
  return (
    <>
      <PageHeader
        title={workspace.name}
        description="Your workspace and your role in it."
        actions={<Badge variant="secondary">{ROLE_LABEL[workspace.role]}</Badge>}
      />
      <div className="grid gap-6">
        {canManage(workspace) && <RenameCard />}
        <DangerCard />
      </div>
    </>
  );
}
