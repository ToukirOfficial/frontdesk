'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useSubmit } from '@/lib/forms';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { pending, formError, run } = useSubmit();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await run(() => api('/auth/forgot-password', { method: 'POST', body: { email }, noRefresh: true }));
    if (ok) setSent(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">Reset your password</h1>
        </CardTitle>
        <CardDescription>We’ll email you a link to choose a new one.</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p role="status" className="text-sm">
            If there’s an account for <span className="font-medium">{email}</span>, a reset link is on its way. It
            expires in 1 hour.
          </p>
        ) : (
          <Form onSubmit={submit} className="grid gap-4">
            <FormError message={formError} />
            <Field label="Email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button type="submit" disabled={pending}>
              {pending ? 'Sending…' : 'Send reset link'}
            </Button>
          </Form>
        )}
        <p className="mt-4 text-sm">
          <Link href="/login" className="underline underline-offset-4">
            Back to log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
