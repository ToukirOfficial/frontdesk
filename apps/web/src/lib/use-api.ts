'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/**
 * GET a path and keep the result in state. Pass null to skip.
 * While reloading, the previous data stays visible (no flashing back to a spinner).
 */
export function useApi<T>(path: string | null): ApiState<T> {
  const [tick, setTick] = useState(0);
  const key = path === null ? null : `${path}#${tick}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: unknown }>();

  useEffect(() => {
    if (key === null || path === null) return;
    let cancelled = false;
    api<T>(path).then(
      (data) => !cancelled && setResult({ key, data }),
      (error: unknown) => !cancelled && setResult((prev) => ({ key, data: prev?.data, error })),
    );
    return () => {
      cancelled = true;
    };
  }, [key, path]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return {
    data: result?.data,
    error: result?.key === key ? result.error : undefined,
    loading: key !== null && result?.key !== key,
    reload,
  };
}
