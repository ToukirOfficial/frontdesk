import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IS_PUBLIC, LOGGED_IN, ROLES } from '../src/common/auth.js';
import { addMember, as, lastEmailTo, nextIp, ORIGIN, PASSWORD, registerOwner, reset, startApp, type TestApp, tokenFrom, uniqueEmail } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(() => t.close());
beforeEach(() => reset(t));

/** Every route that anyone may call without logging in. Adding one here must be a deliberate decision. */
const PUBLIC_ROUTES = new Set([
  'POST /auth/register',
  'POST /auth/login',
  'POST /auth/verify-code',
  'POST /auth/resend-code',
  'POST /auth/refresh',
  'POST /auth/logout',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'GET /invites/:token',
  'POST /invites/accept',
  'GET /health',
  // The widget, on customers' websites. Checked against the workspace's allowed sites and rate-limited.
  'GET /widget/:publicKey/config',
  'POST /widget/:publicKey/session',
  'GET /widget/:publicKey/avatar',
]);

describe('deny by default', () => {
  it('every route declares who may call it, and public routes are exactly the allowed list', () => {
    const discovery = t.app.get(DiscoveryService);
    const scanner = t.app.get(MetadataScanner);
    const reflector = t.app.get(Reflector);
    const found: string[] = [];
    const undeclared: string[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      const controller = wrapper.metatype as (() => unknown) | null;
      if (!instance || !controller) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '').replace(/^\/|\/$/g, '');
      for (const name of scanner.getAllMethodNames(proto)) {
        const handler = (proto as Record<string, unknown>)[name] as () => unknown;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (path === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
        const route = `${method} /${[base, path].filter((p) => p && p !== '/').join('/')}`;
        const targets = [handler, controller];
        const isPublic = reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
        const loggedIn = reflector.getAllAndOverride<boolean>(LOGGED_IN, targets);
        const roles = reflector.getAllAndOverride<string[]>(ROLES, targets);
        if (isPublic) found.push(route);
        else if (!loggedIn && !roles?.length) undeclared.push(route);
      }
    }
    expect(undeclared).toEqual([]);
    expect(new Set(found)).toEqual(PUBLIC_ROUTES);
  });

  it('every non-public route refuses an anonymous request', async () => {
    const id = '0190a0a0-0000-7000-8000-000000000000';
    const routes: [string, string][] = [
      ['get', '/api/auth/me'],
      ['get', '/api/workspaces'],
      ['post', '/api/workspaces'],
      ['get', `/api/workspaces/${id}`],
      ['patch', `/api/workspaces/${id}`],
      ['delete', `/api/workspaces/${id}`],
      ['get', `/api/workspaces/${id}/members`],
      ['patch', `/api/workspaces/${id}/members/${id}`],
      ['delete', `/api/workspaces/${id}/members/${id}`],
      ['get', `/api/workspaces/${id}/invites`],
      ['post', `/api/workspaces/${id}/invites`],
      ['delete', `/api/workspaces/${id}/invites/${id}`],
    ];
    for (const [method, url] of routes) {
      const req = (t.http as unknown as Record<string, (u: string) => import('supertest').Test>)[method]!(url);
      const res = await req.set('Origin', ORIGIN).send({});
      expect(res.status, `${method.toUpperCase()} ${url}`).toBe(401);
    }
  });
});

describe('workspace isolation', () => {
  it('a member of one workspace gets 404 for everything in another', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    const B = `/api/workspaces/${b.workspaceId}`;

    await as(t, a).get(B).expect(404);
    await as(t, a).patch(B, { name: 'Taken over' }).expect(404);
    await as(t, a).delete(B).expect(404);
    await as(t, a).get(`${B}/members`).expect(404);
    await as(t, a).get(`${B}/invites`).expect(404);
    await as(t, a).post(`${B}/invites`, { email: uniqueEmail(), role: 'admin' }).expect(404);
    await as(t, a).delete(`${B}/members/${b.userId}`).expect(404);

    const stillB = await as(t, b).get(B).expect(200);
    expect(stillB.body.name).toBe('Workspace B');
    const list = await as(t, a).get('/api/workspaces').expect(200);
    expect(list.body.items.map((w: { id: string }) => w.id)).toEqual([a.workspaceId]);
  });

  it('an invite id from another workspace cannot be revoked', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    const inv = await as(t, b).post(`/api/workspaces/${b.workspaceId}/invites`, { email: uniqueEmail(), role: 'staff' }).expect(201);
    await as(t, a).delete(`/api/workspaces/${a.workspaceId}/invites/${inv.body.id}`).expect(404);
    const still = await as(t, b).get(`/api/workspaces/${b.workspaceId}/invites`).expect(200);
    expect(still.body.items).toHaveLength(1);
  });

  it('a member id from another workspace cannot be changed or removed', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    const bStaff = await addMember(t, b, 'staff');
    await as(t, a).patch(`/api/workspaces/${a.workspaceId}/members/${bStaff.userId}`, { role: 'admin' }).expect(404);
    await as(t, a).delete(`/api/workspaces/${a.workspaceId}/members/${bStaff.userId}`).expect(404);
  });

  it('a malformed workspace id is a 404, not an error', async () => {
    const a = await registerOwner(t);
    await as(t, a).get('/api/workspaces/not-a-uuid').expect(404);
  });
});

describe('roles', () => {
  it('owner, admin and staff each get exactly their permissions', async () => {
    const owner = await registerOwner(t);
    const admin = await addMember(t, owner, 'admin');
    const staff = await addMember(t, owner, 'staff');
    const W = `/api/workspaces/${owner.workspaceId}`;

    // Everyone can see the workspace.
    for (const s of [owner, admin, staff]) await as(t, s).get(W).expect(200);

    // Rename: owner and admin.
    await as(t, owner).patch(W, { name: 'Renamed' }).expect(200);
    await as(t, admin).patch(W, { name: 'Renamed again' }).expect(200);
    await as(t, staff).patch(W, { name: 'Nope' }).expect(403);

    // Team list and invites: owner and admin.
    await as(t, owner).get(`${W}/members`).expect(200);
    await as(t, admin).get(`${W}/members`).expect(200);
    await as(t, staff).get(`${W}/members`).expect(403);
    await as(t, staff).get(`${W}/invites`).expect(403);
    await as(t, staff).post(`${W}/invites`, { email: uniqueEmail(), role: 'staff' }).expect(403);
    await as(t, admin).post(`${W}/invites`, { email: uniqueEmail(), role: 'staff' }).expect(201);

    // Nobody can invite an owner.
    await as(t, owner).post(`${W}/invites`, { email: uniqueEmail(), role: 'owner' }).expect(400);

    // Role changes: owner only, never the owner's own role.
    await as(t, admin).patch(`${W}/members/${staff.userId}`, { role: 'admin' }).expect(403);
    await as(t, staff).patch(`${W}/members/${staff.userId}`, { role: 'admin' }).expect(403);
    await as(t, owner).patch(`${W}/members/${owner.userId}`, { role: 'staff' }).expect(403);
    const promoted = await as(t, owner).patch(`${W}/members/${staff.userId}`, { role: 'admin' }).expect(200);
    expect(promoted.body.role).toBe('admin');
    await as(t, owner).patch(`${W}/members/${staff.userId}`, { role: 'staff' }).expect(200);

    // Delete workspace: owner only.
    await as(t, admin).delete(W).expect(403);
    await as(t, staff).delete(W).expect(403);
  });

  it('removing members: admin removes staff only, staff only themselves, nobody removes the owner', async () => {
    const owner = await registerOwner(t);
    const admin = await addMember(t, owner, 'admin');
    const admin2 = await addMember(t, owner, 'admin');
    const staff = await addMember(t, owner, 'staff');
    const staff2 = await addMember(t, owner, 'staff');
    const W = `/api/workspaces/${owner.workspaceId}`;

    await as(t, staff).delete(`${W}/members/${staff2.userId}`).expect(403);
    await as(t, admin).delete(`${W}/members/${admin2.userId}`).expect(403);
    await as(t, admin).delete(`${W}/members/${owner.userId}`).expect(403);
    await as(t, owner).delete(`${W}/members/${owner.userId}`).expect(403);

    await as(t, admin).delete(`${W}/members/${staff2.userId}`).expect(200);
    await as(t, staff).delete(`${W}/members/${staff.userId}`).expect(200); // leaving
    await as(t, owner).delete(`${W}/members/${admin2.userId}`).expect(200);

    // Removed people lose access straight away.
    await as(t, staff).get(W).expect(404);
    await as(t, admin2).get(W).expect(404);
  });

  it('the owner can delete the workspace and members lose access', async () => {
    const owner = await registerOwner(t);
    const staff = await addMember(t, owner, 'staff');
    const W = `/api/workspaces/${owner.workspaceId}`;
    await as(t, owner).delete(W).expect(200);
    await as(t, staff).get(W).expect(404);
  });
});

describe('invites', () => {
  it('an existing user accepts with their password and gets a second workspace', async () => {
    const a = await registerOwner(t, 'First');
    const b = await registerOwner(t, 'Second');
    await as(t, b).post(`/api/workspaces/${b.workspaceId}/invites`, { email: a.email, role: 'staff' }).expect(201);
    const token = tokenFrom(await lastEmailTo(t, a.email), '/invite/');

    const preview = await t.http.get(`/api/invites/${token}`).expect(200);
    expect(preview.body).toEqual({ workspaceName: 'Second', email: a.email, role: 'staff', hasAccount: true });

    const send = (password: string) =>
      t.http.post('/api/invites/accept').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).send({ token, password });
    await send('wrong-password-123').expect(401);
    await send(PASSWORD).expect(200);
    await send(PASSWORD).expect(400); // single use

    const list = await as(t, a).get('/api/workspaces').expect(200);
    expect(list.body.items.map((w: { name: string; role: string }) => [w.name, w.role])).toEqual([
      ['First', 'owner'],
      ['Second', 'staff'],
    ]);
  });

  it('refuses an expired or revoked invite', async () => {
    const owner = await registerOwner(t);
    const email = uniqueEmail();
    const inv = await as(t, owner).post(`/api/workspaces/${owner.workspaceId}/invites`, { email, role: 'staff' }).expect(201);
    const token = tokenFrom(await lastEmailTo(t, email), '/invite/');
    await as(t, owner).delete(`/api/workspaces/${owner.workspaceId}/invites/${inv.body.id}`).expect(200);
    await t.http.get(`/api/invites/${token}`).expect(400);

    const email2 = uniqueEmail();
    const inv2 = await as(t, owner).post(`/api/workspaces/${owner.workspaceId}/invites`, { email: email2, role: 'staff' }).expect(201);
    await t.prisma.invite.update({ where: { id: inv2.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const token2 = tokenFrom(await lastEmailTo(t, email2), '/invite/');
    await t.http
      .post('/api/invites/accept')
      .set('Origin', ORIGIN)
      .send({ token: token2, name: 'Late', password: PASSWORD })
      .expect(400);
  });

  it('refuses to invite someone who is already a member', async () => {
    const owner = await registerOwner(t);
    const staff = await addMember(t, owner, 'staff');
    const res = await as(t, owner)
      .post(`/api/workspaces/${owner.workspaceId}/invites`, { email: staff.email, role: 'admin' })
      .expect(409);
    expect(res.body.errorCode).toBe('ALREADY_MEMBER');
  });
});
