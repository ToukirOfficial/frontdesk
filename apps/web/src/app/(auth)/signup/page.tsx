'use client';

import type { Challenge } from '@frontdesk/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CodeStep } from '@/components/code-step';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { useSubmit } from '@/lib/forms';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ workspaceName: '', name: '', email: '', password: '' });
  const [challenge, setChallenge] = useState<Challenge>();
  const { pending, formError, fields, run } = useSubmit();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = await run(() => api<Challenge>('/auth/register', { method: 'POST', body: form, noRefresh: true }));
    if (c) setChallenge(c);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">{challenge ? 'Check your email' : 'Create your account'}</h1>
        </CardTitle>
        {!challenge && <CardDescription>Set up a workspace for your business.</CardDescription>}
      </CardHeader>
      <CardContent>
        {challenge ? (
          <CodeStep
            challenge={challenge}
            email={form.email}
            onBack={() => router.replace('/login')}
            onDone={() => router.replace('/w')}
          />
        ) : (
          <Form onSubmit={submit} className="grid gap-4">
            <FormError message={formError} />
            <Field
              label="Business name"
              required
              autoComplete="organization"
              value={form.workspaceName}
              onChange={set('workspaceName')}
              error={fields.workspaceName}
            />
            <Field label="Your name" required autoComplete="name" value={form.name} onChange={set('name')} error={fields.name} />
            <Field
              label="Email"
              type="email"
              required
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
              error={fields.email}
            />
            <Field
              label="Password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              value={form.password}
              onChange={set('password')}
              error={fields.password}
              hint="At least 10 characters."
            />
            <Button type="submit" disabled={pending}>
              {pending ? 'Creating…' : 'Create account'}
            </Button>
            <p className="text-sm">
              Already have an account?{' '}
              <Link href="/login" className="underline underline-offset-4">
                Log in
              </Link>
            </p>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
