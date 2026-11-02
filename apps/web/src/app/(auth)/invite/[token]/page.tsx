'use client';

import type { InvitePreview } from '@frontdesk/shared';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { ErrorState, LoadingState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useSubmit } from '@/lib/forms';
import { useApi } from '@/lib/use-api';

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<InvitePreview>(`/invites/${encodeURIComponent(token)}`);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { pending, formError, fields, run } = useSubmit();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await run(() =>
      api<{ workspaceId: string }>('/invites/accept', {
        method: 'POST',
        body: data?.hasAccount ? { token, password } : { token, name, password },
        noRefresh: true,
      }),
    );
    if (res) router.replace(`/w/${res.workspaceId}`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">{data ? `Join ${data.workspaceName}` : 'Your invite'}</h1>
        </CardTitle>
        {data && (
          <CardDescription>
            You’ve been invited as {data.role === 'admin' ? 'an admin' : 'staff'} ({data.email}).
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingState />
        ) : error || !data ? (
          <>
            <ErrorState error={error} onRetry={reload} />
            <p className="text-center text-sm">
              <Link href="/login" className="underline underline-offset-4">
                Go to log in
              </Link>
            </p>
          </>
        ) : (
          <Form onSubmit={submit} className="grid gap-4">
            <FormError message={formError} />
            {!data.hasAccount && (
              <Field label="Your name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
            )}
            <Field
              label={data.hasAccount ? 'Your Frontdesk password' : 'Choose a password'}
              type="password"
              required
              minLength={data.hasAccount ? undefined : 10}
              autoComplete={data.hasAccount ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fields.password}
              hint={data.hasAccount ? 'You already have an account with this email.' : 'At least 10 characters.'}
            />
            <Button type="submit" disabled={pending}>
              {pending ? 'Joining…' : 'Accept invite'}
            </Button>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
