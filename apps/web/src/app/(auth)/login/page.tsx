'use client';

import type { Challenge } from '@frontdesk/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { CodeStep } from '@/components/code-step';
import { DemoLoginButton } from '@/components/demo-login';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, safeNext } from '@/lib/api';
import { useSubmit } from '@/lib/forms';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<Challenge>();
  const { pending, formError, run } = useSubmit();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = await run(() => api<Challenge>('/auth/login', { method: 'POST', body: { email, password }, noRefresh: true }));
    if (c) setChallenge(c);
  };

  if (challenge) {
    return (
      <CodeStep
        challenge={challenge}
        email={email}
        onBack={() => setChallenge(undefined)}
        onDone={() => router.replace(safeNext(params.get('next')))}
      />
    );
  }

  return (
    <Form onSubmit={submit} className="grid gap-4">
      <FormError message={formError} />
      <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Continue'}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="underline underline-offset-4">
          Forgot password?
        </Link>
        <Link href="/signup" className="underline underline-offset-4">
          Create an account
        </Link>
      </div>
    </Form>
  );
}

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">Log in</h1>
        </CardTitle>
        <CardDescription>We’ll email you a code to finish logging in.</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <LoginForm />
        </Suspense>
        <DemoLoginButton checkDemo className="mt-4 border-t pt-4" />
      </CardContent>
    </Card>
  );
}
