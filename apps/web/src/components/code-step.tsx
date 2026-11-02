'use client';

import type { Challenge, Me } from '@frontdesk/shared';
import { useState } from 'react';
import { Field, FormError } from '@/components/field';
import { Form } from '@/components/form';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { useSubmit } from '@/lib/forms';

/** Second login step: the 6-digit code from the email. */
export function CodeStep({
  challenge,
  email,
  onDone,
  onBack,
}: {
  challenge: Challenge;
  email: string;
  onDone: (me: Me) => void;
  onBack: () => void;
}) {
  const [current, setCurrent] = useState(challenge);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string>();
  const { pending, formError, fields, run, setFormError } = useSubmit();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const me = await run(() =>
      api<Me>('/auth/verify-code', { method: 'POST', body: { challengeId: current.challengeId, code }, noRefresh: true }),
    );
    if (me) onDone(me);
  };

  const resend = async () => {
    setNotice(undefined);
    try {
      const next = await api<Challenge>('/auth/resend-code', {
        method: 'POST',
        body: { challengeId: current.challengeId },
        noRefresh: true,
      });
      setCurrent(next);
      setCode('');
      setNotice('We’ve sent a new code.');
    } catch (err) {
      setFormError(errorMessage(err));
    }
  };

  return (
    <Form onSubmit={submit} className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        We’ve emailed a 6-digit code to <span className="font-medium text-foreground">{email}</span>. It expires in 10
        minutes.
      </p>
      <FormError message={formError} />
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      <Field
        label="Code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        value={code}
        error={fields.code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        className="text-lg tracking-[0.3em]"
      />
      <Button type="submit" disabled={pending || code.length !== 6}>
        {pending ? 'Checking…' : 'Continue'}
      </Button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} className="underline underline-offset-4">
          Back
        </button>
        <button type="button" onClick={resend} className="underline underline-offset-4">
          Send a new code
        </button>
      </div>
    </Form>
  );
}
