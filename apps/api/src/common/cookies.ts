import type { CookieOptions, Request, Response } from 'express';

export const ACCESS_COOKIE = 'fd_access';
export const REFRESH_COOKIE = 'fd_refresh';
export const ACCESS_TTL_SEC = 15 * 60;
export const REFRESH_TTL_SEC = 30 * 24 * 60 * 60;

/** Reads one cookie from the Cookie header (no cookie-parser dependency needed). */
export const readCookie = (req: { headers: Request['headers'] }, name: string): string | undefined => {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};

// Secure everywhere: browsers treat http://localhost as a secure context, so this works in dev too.
const base: CookieOptions = { httpOnly: true, secure: true, sameSite: 'lax' };
const accessOpts: CookieOptions = { ...base, path: '/' };
// The refresh token is only ever sent to the auth endpoints.
const refreshOpts: CookieOptions = { ...base, path: '/api/auth' };

export const setAuthCookies = (res: Response, access: string, refresh: string): void => {
  res.cookie(ACCESS_COOKIE, access, { ...accessOpts, maxAge: ACCESS_TTL_SEC * 1000 });
  res.cookie(REFRESH_COOKIE, refresh, { ...refreshOpts, maxAge: REFRESH_TTL_SEC * 1000 });
};

export const clearAuthCookies = (res: Response): void => {
  res.clearCookie(ACCESS_COOKIE, accessOpts);
  res.clearCookie(REFRESH_COOKIE, refreshOpts);
};
