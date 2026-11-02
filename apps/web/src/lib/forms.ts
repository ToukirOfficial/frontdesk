'use client';

import { useState } from 'react';
import { ApiError, errorMessage } from './api';

/** Tracks submitting state plus form-level and per-field errors from an API call. */
export function useSubmit() {
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});

  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setFormError(undefined);
    setFields({});
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      setFormError(errorMessage(err));
      return undefined;
    } finally {
      setPending(false);
    }
  };
  return { pending, formError, fields, run, setFormError };
}
