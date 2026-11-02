import type { ErrorBody } from '@frontdesk/shared';

/** An error response from the API, with its stable errorCode and per-field messages. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface Options {
  method?: Method;
  body?: unknown;
  /** Don't try a token refresh / redirect on 401 (auth pages). */
  noRefresh?: boolean;
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time: two parallel 401s must not both rotate the refresh token (that looks like reuse). */
const refreshSession = (): Promise<boolean> => {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      setTimeout(() => (refreshing = null), 0);
    });
  return refreshing;
};

const toLogin = () => {
  if (typeof window === 'undefined') return;
  const next = window.location.pathname + window.location.search;
  // A full page load on purpose: it drops every piece of in-memory state from the old session.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full load drops the old session's state
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
};

/** Calls the NestJS API through the same-origin /api rewrite. Cookies carry the session. */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const send = () =>
    fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: opts.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res = await send();
  if (res.status === 401 && !opts.noRefresh) {
    if (await refreshSession()) res = await send();
    if (res.status === 401) {
      toLogin();
      throw new ApiError(401, 'UNAUTHENTICATED', 'Please log in.');
    }
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ErrorBody>;
    throw new ApiError(res.status, err.errorCode ?? 'INTERNAL', err.message ?? 'Something went wrong.', err.fields);
  }
  return data as T;
}

/** A user-facing message for any thrown value. */
export const errorMessage = (err: unknown): string =>
  err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';

/** Only same-site paths, so ?next= can't send people to another site. */
export const safeNext = (next: string | null, fallback = '/w'): string =>
  next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
