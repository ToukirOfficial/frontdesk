import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  as,
  codeFrom,
  cookiesOf,
  cookieValue,
  lastEmailTo,
  login,
  nextIp,
  ORIGIN,
  PASSWORD,
  registerOwner,
  reset,
  startApp,
  type TestApp,
  tokenFrom,
} from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());
beforeEach(() => reset(t));

const post = (url: string, body: object, ip = nextIp()) =>
  t.http.post(url).set('Origin', ORIGIN).set('X-Forwarded-For', ip).send(body);

describe('login with password and emailed code', () => {
  it('signs up, emails a code and only starts a session after the code', async () => {
    const email = 'new-owner@example.test';
    const reg = await post('/api/auth/register', {
      workspaceName: 'Riverside Physio',
      name: 'Alex Example',
      email,
      password: PASSWORD,
    }).expect(201);
    expect(reg.body).toEqual({ challengeId: expect.any(String), expiresInSec: 600 });
    expect(reg.headers['set-cookie']).toBeUndefined(); // no session before the code

    const code = codeFrom(await lastEmailTo(t, email));
    const ok = await post('/api/auth/verify-code', { challengeId: reg.body.challengeId, code }).expect(200);
    expect(ok.body).toEqual({ id: expect.any(String), email, name: 'Alex Example' });
    const cookie = cookiesOf(ok);
    expect(cookie).toContain('fd_access=');
    expect(cookie).toContain('fd_refresh=');

    const set = (ok.headers['set-cookie'] as unknown as string[]).join(';');
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Secure/);
    expect(set).toMatch(/SameSite=Lax/);

    const me = await t.http.get('/api/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.email).toBe(email);
    const ws = await t.http.get('/api/workspaces').set('Cookie', cookie).expect(200);
    expect(ws.body.items).toEqual([expect.objectContaining({ name: 'Riverside Physio', role: 'owner' })]);
  });

  it('never returns the password hash or code hash', async () => {
    const owner = await registerOwner(t);
    const me = await as(t, owner).get('/api/auth/me').expect(200);
    expect(Object.keys(me.body).sort()).toEqual(['email', 'id', 'name']);
  });

  it('refuses a wrong password with the same message as an unknown email', async () => {
    const owner = await registerOwner(t);
    const wrong = await post('/api/auth/login', { email: owner.email, password: 'wrong-password-123' }).expect(401);
    const unknown = await post('/api/auth/login', { email: 'nobody@example.test', password: PASSWORD }).expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('asks for a code on every login', async () => {
    const owner = await registerOwner(t);
    const res = await post('/api/auth/login', { email: owner.email, password: PASSWORD }).expect(200);
    expect(res.body.challengeId).toEqual(expect.any(String));
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a wrong code, then locks the code after 5 attempts', async () => {
    const owner = await registerOwner(t);
    const ip = nextIp();
    const { body } = await post('/api/auth/login', { email: owner.email, password: PASSWORD }, ip).expect(200);
    const code = codeFrom(await lastEmailTo(t, owner.email));
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i++) {
      const r = await post('/api/auth/verify-code', { challengeId: body.challengeId, code: wrong }, ip).expect(400);
      expect(r.body.errorCode).toBe('CODE_INVALID');
    }
    // Even the right code is refused now.
    const locked = await post('/api/auth/verify-code', { challengeId: body.challengeId, code }, ip).expect(400);
    expect(locked.body.errorCode).toBe('CODE_EXPIRED');
  });

  it('accepts a code only once', async () => {
    const owner = await registerOwner(t);
    const { body } = await post('/api/auth/login', { email: owner.email, password: PASSWORD }).expect(200);
    const code = codeFrom(await lastEmailTo(t, owner.email));
    await post('/api/auth/verify-code', { challengeId: body.challengeId, code }).expect(200);
    const again = await post('/api/auth/verify-code', { challengeId: body.challengeId, code }).expect(400);
    expect(again.body.errorCode).toBe('CODE_EXPIRED');
  });

  it('refuses an expired code', async () => {
    const owner = await registerOwner(t);
    const { body } = await post('/api/auth/login', { email: owner.email, password: PASSWORD }).expect(200);
    const code = codeFrom(await lastEmailTo(t, owner.email));
    await t.prisma.loginCode.update({ where: { id: body.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await post('/api/auth/verify-code', { challengeId: body.challengeId, code }).expect(400);
  });

  it('a newer login code makes the older one stop working', async () => {
    const owner = await registerOwner(t);
    const first = await post('/api/auth/login', { email: owner.email, password: PASSWORD }).expect(200);
    const firstCode = codeFrom(await lastEmailTo(t, owner.email));
    await post('/api/auth/login', { email: owner.email, password: PASSWORD }).expect(200);
    await post('/api/auth/verify-code', { challengeId: first.body.challengeId, code: firstCode }).expect(400);
  });

  it('resend-code issues a new working code', async () => {
    const owner = await registerOwner(t);
    const first = await post('/api/auth/login', { email: owner.email, password: PASSWORD }).expect(200);
    const second = await post('/api/auth/resend-code', { challengeId: first.body.challengeId }).expect(200);
    const code = codeFrom(await lastEmailTo(t, owner.email));
    await post('/api/auth/verify-code', { challengeId: second.body.challengeId, code }).expect(200);
  });
});

describe('refresh tokens', () => {
  it('rotates the refresh token and keeps the session working', async () => {
    const owner = await registerOwner(t);
    const res = await t.http.post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', owner.cookie).expect(200);
    const next = cookiesOf(res);
    expect(cookieValue(next, 'fd_refresh')).not.toBe(cookieValue(owner.cookie, 'fd_refresh'));
    await t.http.get('/api/auth/me').set('Cookie', next).expect(200);
  });

  it('reusing a rotated refresh token revokes the whole family', async () => {
    const owner = await registerOwner(t);
    const rotated = cookiesOf(
      await t.http.post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', owner.cookie).expect(200),
    );
    // The old token again: treated as theft.
    await t.http.post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', owner.cookie).expect(401);
    // And now the legitimate newer token is dead too.
    await t.http.post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', rotated).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const owner = await registerOwner(t);
    await t.http.post('/api/auth/logout').set('Origin', ORIGIN).set('Cookie', owner.cookie).expect(200);
    await t.http.post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', owner.cookie).expect(401);
  });

  it('refuses a garbage or missing access token', async () => {
    await t.http.get('/api/auth/me').expect(401);
    await t.http.get('/api/auth/me').set('Cookie', 'fd_access=not-a-jwt').expect(401);
  });
});

describe('password reset', () => {
  it('resets the password once and logs out everywhere', async () => {
    const owner = await registerOwner(t);
    await post('/api/auth/forgot-password', { email: owner.email }).expect(200);
    const token = tokenFrom(await lastEmailTo(t, owner.email), 'token=');
    await post('/api/auth/reset-password', { token, password: 'a-brand-new-password' }).expect(200);
    await post('/api/auth/reset-password', { token, password: 'another-new-password' }).expect(400);

    await t.http.post('/api/auth/refresh').set('Origin', ORIGIN).set('Cookie', owner.cookie).expect(401);
    await post('/api/auth/login', { email: owner.email, password: PASSWORD }).expect(401);
    await login(t, owner.email, 'a-brand-new-password');
  });

  it('answers the same for unknown emails', async () => {
    await post('/api/auth/forgot-password', { email: 'nobody@example.test' }).expect(200);
  });
});

describe('rate limits', () => {
  it('limits login attempts per email', async () => {
    const owner = await registerOwner(t);
    for (let i = 0; i < 5; i++) {
      await post('/api/auth/login', { email: owner.email, password: 'wrong-password-123' }).expect(401);
    }
    const limited = await post('/api/auth/login', { email: owner.email, password: PASSWORD }).expect(429);
    expect(limited.body.errorCode).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits login attempts per IP across emails', async () => {
    const ip = nextIp();
    for (let i = 0; i < 20; i++) {
      await post('/api/auth/login', { email: `x${i}@example.test`, password: 'wrong-password-123' }, ip).expect(401);
    }
    await post('/api/auth/login', { email: 'y@example.test', password: 'wrong-password-123' }, ip).expect(429);
  });

  it('limits code guesses per IP', async () => {
    const ip = nextIp();
    const id = '0190a0a0-0000-7000-8000-000000000000';
    for (let i = 0; i < 30; i++) {
      await post('/api/auth/verify-code', { challengeId: id, code: '123456' }, ip).expect(400);
    }
    await post('/api/auth/verify-code', { challengeId: id, code: '123456' }, ip).expect(429);
  });

  it('limits password reset requests per email', async () => {
    const email = 'someone@example.test';
    for (let i = 0; i < 3; i++) await post('/api/auth/forgot-password', { email }).expect(200);
    await post('/api/auth/forgot-password', { email }).expect(429);
  });

  it('limits sign-ups per IP', async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      await post(
        '/api/auth/register',
        { workspaceName: 'Shop', name: 'A', email: `s${i}@example.test`, password: PASSWORD },
        ip,
      ).expect(201);
    }
    await post(
      '/api/auth/register',
      { workspaceName: 'Shop', name: 'A', email: 's9@example.test', password: PASSWORD },
      ip,
    ).expect(429);
  });
});

describe('input validation and CSRF', () => {
  it('rejects invalid bodies with field errors', async () => {
    const res = await post('/api/auth/register', { workspaceName: 'x', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.fields)).toEqual(expect.arrayContaining(['workspaceName', 'name', 'email', 'password']));
  });

  it('refuses cookie-authenticated writes from another origin', async () => {
    const owner = await registerOwner(t);
    const res = await t.http
      .post('/api/workspaces')
      .set('Origin', 'https://evil.example')
      .set('Cookie', owner.cookie)
      .send({ name: 'Sneaky' })
      .expect(403);
    expect(res.body.errorCode).toBe('BAD_ORIGIN');
  });
});
