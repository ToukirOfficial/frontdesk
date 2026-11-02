'use client';

import type { ComponentProps, FormEvent } from 'react';
import { useHydrated } from '@/lib/use-hydrated';

/**
 * Every form in the app. Forms are submitted by JavaScript (`onSubmit` calls the API), so:
 * - `method="post"`: if the browser ever submitted natively, nothing would end up in the URL (or in logs).
 * - Every control is disabled until React has hydrated, so a click can't land before `onSubmit` exists.
 */
export function Form({
  onSubmit,
  children,
  ...props
}: Omit<ComponentProps<'form'>, 'method' | 'action' | 'onSubmit'> & { onSubmit: (e: FormEvent<HTMLFormElement>) => void }) {
  const hydrated = useHydrated();
  return (
    <form {...props} method="post" onSubmit={onSubmit} aria-busy={!hydrated || undefined}>
      <fieldset disabled={!hydrated} className="contents">
        {children}
      </fieldset>
    </form>
  );
}
