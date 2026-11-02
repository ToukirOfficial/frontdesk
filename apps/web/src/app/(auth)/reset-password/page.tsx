'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useSubmit } from '@/lib/forms';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const { pending, formError, fields, run } = useSubmit();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api('/auth/reset-password', { method: 'POST', body: { token, password }, noRefresh: true }));
    if (ok) setDone(true);
  };

  if (done) {
    return (
      <p role="status" className="text-sm">
        Your password has been changed and you’ve been logged out everywhere.{' '}
        <Link href="/login" className="underline underline-offset-4">
          Log in
        </Link>
      </p>
    );
  }
  return (
    <Form onSubmit={submit} className="grid gap-4">
      <FormError message={formError} />
      <Field
        label="New password"
        type="password"
        required
        minLength={10}
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fields.password}
        hint="At least 10 characters."
      />
      <Button type="submit" disabled={pending || !token}>
        {pending ? 'Saving…' : 'Save new password'}
      </Button>
    </Form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">Choose a new password</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense>
          <ResetForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
