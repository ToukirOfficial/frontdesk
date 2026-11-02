'use client';

import type { Workspace, WorkspaceList } from '@frontdesk/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { Logo } from '@/components/logo';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', staff: 'Staff' } as const;

function Workspaces() {
  const router = useRouter();
  const wantsNew = useSearchParams().get('new') === '1';
  const { data, error, loading, reload } = useApi<WorkspaceList>('/workspaces');
  const [name, setName] = useState('');
  const { pending, formError, fields, run } = useSubmit();

  // One workspace and not asking for another: go straight in.
  const only = data?.items.length === 1 && !wantsNew ? data.items[0] : undefined;
  useEffect(() => {
    if (only) router.replace(`/w/${only.id}`);
  }, [only, router]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const ws = await run(() => api<Workspace>('/workspaces', { method: 'POST', body: { name } }));
    if (ws) router.push(`/w/${ws.id}`);
  };

  if (loading || only) return <LoadingState />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div className="grid gap-6">
      {data.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-lg">Your workspaces</h1>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1">
              {data.items.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/w/${w.id}`}
                    className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{w.name}</span>
                      <span className="text-sm text-muted-foreground">{ROLE_LABEL[w.role]}</span>
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg">{data.items.length ? 'New workspace' : 'Create your first workspace'}</h2>
          </CardTitle>
          <CardDescription>One workspace per business. You’ll be its owner.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form onSubmit={create} className="grid gap-4">
            <FormError message={formError} />
            <Field label="Business name" required value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create workspace'}
            </Button>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkspacesPage() {
  return (
    <div className="mx-auto grid min-h-dvh max-w-md content-center gap-6 px-4 py-10">
      <Logo />
      <Suspense>
        <Workspaces />
      </Suspense>
    </div>
  );
}
