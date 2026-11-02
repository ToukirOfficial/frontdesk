import { deflateRawSync } from 'node:zlib';
import { JwtService } from '@nestjs/jwt';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DASHBOARD_AUDIENCE } from '../src/auth/sessions.service.js';
import { checkDocxSize, ExtractError } from '../src/knowledge/extract.js';
import { addMember, as, ORIGIN, registerOwner, reset, startApp, type TestApp } from './helpers.js';
import { collect, keyOf, listen, say, staffSocket, until, visitorSocket, widgetSession } from './socket-helpers.js';

/** A minimal zip with one deflated entry, like a .docx's word/document.xml. */
const zipWith = (name: string, content: Buffer): Buffer => {
  const data = deflateRawSync(content);
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42); // local header at 0
  const cdStart = local.length + n.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(cdStart, 16);
  return Buffer.concat([local, n, data, central, n, end]);
};

describe('zip bombs disguised as Word files', () => {
  it('a normal document passes; one that unpacks to far more than any real document is refused before reading', () => {
    expect(() => checkDocxSize(zipWith('word/document.xml', Buffer.from('<w:document>Hello</w:document>')))).not.toThrow();
    // ~100 MB of zeros squeezes into ~100 KB: well under the upload limit, ruinous once unpacked.
    const bomb = zipWith('word/document.xml', Buffer.alloc(100 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(() => checkDocxSize(bomb)).toThrow(ExtractError);
    expect(() => checkDocxSize(Buffer.from('not a zip at all, just text'))).toThrow(ExtractError);
  });
});

describe('live dashboard sockets', () => {
  let t: TestApp;
  let base: string;
  beforeAll(async () => {
    t = await startApp();
    base = await listen(t);
  });
  afterAll(() => t.close());
  beforeEach(() => reset(t));

  it('someone removed from a workspace stops receiving its live chats at once', async () => {
    const owner = await registerOwner(t);
    const staff = await addMember(t, owner, 'staff');
    const socket = await staffSocket(base, staff.cookie, owner.workspaceId);
    const seen = collect(socket, 'message');
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    const visitor = await visitorSocket(base, key, s.token);
    await say(visitor, 'First message');
    await until(() => seen.length > 0);

    await as(t, owner).delete(`/api/workspaces/${owner.workspaceId}/members/${staff.userId}`).expect(200);
    const before = seen.length;
    await say(visitor, 'Private message after removal');
    await new Promise((r) => setTimeout(r, 300));
    expect(seen.length).toBe(before);
    // And they can't join again.
    expect(await socket.emitWithAck('join', { workspaceId: owner.workspaceId })).toEqual({ ok: false });
    socket.disconnect();
    visitor.disconnect();
  });

  it('a socket is closed when the login that opened it expires', async () => {
    const owner = await registerOwner(t);
    // JWT expiry is in whole seconds: 3 s leaves room to connect on a slow machine before it runs out.
    const token = await t.app.get(JwtService).signAsync({ sub: owner.userId }, { audience: DASHBOARD_AUDIENCE, expiresIn: 3 });
    const socket = io(`${base}/staff`, {
      path: '/api/socket.io',
      addTrailingSlash: false,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { cookie: `fd_access=${token}`, origin: ORIGIN },
    });
    let reason = '';
    socket.on('disconnect', (r) => (reason = r));
    await until(() => socket.connected, 2000);
    await until(() => reason !== '', 6000);
    expect(reason).toBe('io server disconnect');
  });
});

describe('limits on things that send email', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());
  beforeEach(() => reset(t));

  it('the same address can only be invited a few times a day, across workspaces', async () => {
    const a = await registerOwner(t, 'Shop A');
    const b = await registerOwner(t, 'Shop B');
    const email = 'target@example.test';
    for (const owner of [a, b, a]) {
      await as(t, owner).post(`/api/workspaces/${owner.workspaceId}/invites`, { email, role: 'staff' }).expect(201);
    }
    await as(t, b).post(`/api/workspaces/${b.workspaceId}/invites`, { email, role: 'staff' }).expect(429);
  });

  it('one person can only create a few workspaces a day', async () => {
    const owner = await registerOwner(t);
    for (let i = 0; i < 10; i++) await as(t, owner).post('/api/workspaces', { name: `Extra ${i}` }).expect(201);
    await as(t, owner).post('/api/workspaces', { name: 'One too many' }).expect(429);
  });
});
