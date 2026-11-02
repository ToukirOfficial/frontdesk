import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addMember, as, lastEmailTo, registerOwner, reset, startApp, type TestApp } from './helpers.js';
import { keyOf, widgetSession } from './socket-helpers.js';

const KEY = 'sw_live_abc123_secretpart';
const SERVICE = '0190a0a0-0000-7000-8000-0000000000aa';
const TAKEN = '2026-11-10T10:00:00.000Z';

/** A stand-in for Slotwise's public API, recording what it receives. */
let slotwise: Server;
let slotwiseUrl: string;
const received: { method: string; url: string; auth?: string; idem?: string; body?: unknown }[] = [];
const bookedKeys = new Map<string, string>();

const readBody = (req: IncomingMessage) =>
  new Promise<string>((r) => {
    let b = '';
    req.on('data', (c: Buffer) => (b += c.toString()));
    req.on('end', () => r(b));
  });

let t: TestApp;
beforeAll(async () => {
  slotwise = createServer(async (req, res) => {
    const raw = await readBody(req);
    const body = raw ? (JSON.parse(raw) as { startsAt?: string }) : undefined;
    received.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, idem: req.headers['idempotency-key'] as string, body });
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end('{"errorCode":"UNAUTHENTICATED"}');
    if (req.url === '/api/v1/services') {
      return res.end(JSON.stringify([{ id: SERVICE, name: 'Sports massage', durationMin: 45, pricePence: 5500, active: true }]));
    }
    if (req.url?.startsWith('/api/v1/availability')) {
      return res.end(
        JSON.stringify({
          zone: 'Europe/London',
          serviceId: SERVICE,
          staffId: null,
          days: [{ date: '2026-11-10', slots: [{ startsAt: TAKEN, endsAt: '2026-11-10T10:45:00.000Z', localTime: '10:00' }] }],
        }),
      );
    }
    if (req.url === '/api/v1/bookings' && req.method === 'POST') {
      if (body?.startsAt === TAKEN) return res.writeHead(409).end('{"statusCode":409,"errorCode":"SLOT_TAKEN","message":"Taken"}');
      const key = req.headers['idempotency-key'] as string;
      const id = bookedKeys.get(key) ?? randomUUID();
      bookedKeys.set(key, id);
      return res.writeHead(201).end(JSON.stringify({ id, startsAt: body?.startsAt, status: 'confirmed' }));
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => slotwise.listen(0, '127.0.0.1', r));
  slotwiseUrl = `http://127.0.0.1:${(slotwise.address() as AddressInfo).port}`;
  // Tests only: lets the API reach the local stand-in.
  t = await startApp({ ALLOW_PRIVATE_URLS: 'true' });
});
afterAll(async () => {
  await t.close();
  await new Promise<void>((r) => slotwise.close(() => r()));
});
beforeEach(async () => {
  await reset(t);
  received.length = 0;
});

describe('enquiries', () => {
  const body = (token: string) => ({ token, name: 'Alex Example', email: 'alex@example.test', phone: '', need: 'Can I bring my dog?', consent: true });

  it('stores the enquiry with consent, emails the business and notes it in the chat', async () => {
    const owner = await registerOwner(t);
    await as(t, owner)
      .put(`/api/workspaces/${owner.workspaceId}/business`, {
        name: 'Riverside Physio',
        address: '',
        openingHours: {
          mon: { closed: true, open: '09:00', close: '17:00' },
          tue: { closed: true, open: '09:00', close: '17:00' },
          wed: { closed: true, open: '09:00', close: '17:00' },
          thu: { closed: true, open: '09:00', close: '17:00' },
          fri: { closed: true, open: '09:00', close: '17:00' },
          sat: { closed: true, open: '09:00', close: '17:00' },
          sun: { closed: true, open: '09:00', close: '17:00' },
          notes: '',
        },
        email: 'hello@riverside.example',
        phone: '',
        bookingUrl: '',
      })
      .expect(200);
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    await t.http.post(`/api/widget/${key}/enquiry`).send(body(s.token)).expect(201);

    const row = await t.prisma.enquiry.findFirstOrThrow({ where: { workspaceId: owner.workspaceId } });
    expect(row).toMatchObject({ name: 'Alex Example', email: 'alex@example.test', phone: null, need: 'Can I bring my dog?', conversationId: s.conversationId });
    expect(row.consentText).toContain('Riverside Physio');
    // The contact email isn't a member's (unverified), so it gets nothing: the owner does.
    await expect(lastEmailTo(t, 'hello@riverside.example')).rejects.toThrow();
    const mail = await lastEmailTo(t, owner.email);
    expect(mail.subject).toContain('Alex Example');
    expect(mail.text).toContain('Can I bring my dog?');
    const note = await t.prisma.message.findFirstOrThrow({ where: { conversationId: s.conversationId, role: 'system' } });
    expect(note.content).toContain('passed to the team');
  });

  it('emails admins too, and the contact address when it belongs to a member', async () => {
    const owner = await registerOwner(t);
    const admin = await addMember(t, owner, 'admin');
    const staff = await addMember(t, owner, 'staff');
    const profile = (await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/business`).expect(200)).body;
    await as(t, owner).put(`/api/workspaces/${owner.workspaceId}/business`, { ...profile, email: staff.email }).expect(200);
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    await t.http.post(`/api/widget/${key}/enquiry`).send(body(s.token)).expect(201);
    for (const to of [owner.email, admin.email, staff.email]) expect((await lastEmailTo(t, to)).text).toContain('Can I bring my dog?');
  });

  it('emails the owner when the business has no contact email', async () => {
    const owner = await registerOwner(t);
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    await t.http.post(`/api/widget/${key}/enquiry`).send(body(s.token)).expect(201);
    expect((await lastEmailTo(t, owner.email)).text).toContain('Can I bring my dog?');
  });

  it('needs consent, a way to reply, and a token for this workspace', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    const keyA = await keyOf(t, a);
    const sA = await widgetSession(t, keyA);
    const sB = await widgetSession(t, await keyOf(t, b));
    await t.http.post(`/api/widget/${keyA}/enquiry`).send({ ...body(sA.token), consent: false }).expect(400);
    await t.http.post(`/api/widget/${keyA}/enquiry`).send({ ...body(sA.token), email: '', phone: '' }).expect(400);
    await t.http.post(`/api/widget/${keyA}/enquiry`).send(body(sB.token)).expect(401);
    expect(await t.prisma.enquiry.count()).toBe(0);
  });

  it('is rate-limited per IP', async () => {
    const owner = await registerOwner(t);
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    for (let i = 0; i < 5; i++) await t.http.post(`/api/widget/${key}/enquiry`).set('X-Forwarded-For', '10.9.9.9').send(body(s.token)).expect(201);
    await t.http.post(`/api/widget/${key}/enquiry`).set('X-Forwarded-For', '10.9.9.9').send(body(s.token)).expect(429);
  });
});

describe('booking through Slotwise', () => {
  const connect = async () => {
    const owner = await registerOwner(t);
    await as(t, owner).put(`/api/workspaces/${owner.workspaceId}/slotwise`, { baseUrl: slotwiseUrl, apiKey: KEY }).expect(200);
    const key = await keyOf(t, owner);
    return { owner, key, s: await widgetSession(t, key) };
  };

  it('the widget config says booking is available', async () => {
    const { key } = await connect();
    const cfg = await t.http.get(`/api/widget/${key}/config`).expect(200);
    expect(cfg.body.booking).toBe('slotwise');
  });

  it('lists services and free times, and books with the decrypted key and an Idempotency-Key', async () => {
    const { key, s } = await connect();
    const services = await t.http.post(`/api/widget/${key}/booking/services`).send({ token: s.token }).expect(200);
    expect(services.body.items).toEqual([{ id: SERVICE, name: 'Sports massage', durationMin: 45, pricePence: 5500 }]);

    const today = new Date().toISOString().slice(0, 10);
    const slots = await t.http.post(`/api/widget/${key}/booking/slots`).send({ token: s.token, serviceId: SERVICE, from: today, to: today }).expect(200);
    expect(slots.body.days[0].slots[0]).toEqual({ startsAt: TAKEN, localTime: '10:00' });

    const idempotencyKey = randomUUID();
    const book = {
      token: s.token,
      serviceId: SERVICE,
      startsAt: '2026-11-10T11:00:00.000Z',
      idempotencyKey,
      name: 'Alex Example',
      email: 'alex@example.test',
      phone: '',
      consent: true,
    };
    const res = await t.http.post(`/api/widget/${key}/booking`).send(book).expect(201);
    expect(res.body).toEqual({ startsAt: '2026-11-10T11:00:00.000Z', serviceName: 'Sports massage' });

    const post = received.find((r) => r.method === 'POST' && r.url === '/api/v1/bookings')!;
    expect(post.auth).toBe(`Bearer ${KEY}`);
    expect(post.idem).toBe(idempotencyKey);
    expect(post.body).toEqual({
      serviceId: SERVICE,
      startsAt: '2026-11-10T11:00:00.000Z',
      staffId: 'any',
      customer: { name: 'Alex Example', email: 'alex@example.test', phone: '' },
    });
    const note = await t.prisma.message.findFirstOrThrow({ where: { conversationId: s.conversationId, role: 'system' } });
    expect(note.content).toMatch(/^Booked: Sports massage, .* \(UK time\)/);
  });

  it('turns SLOT_TAKEN into a clear 409', async () => {
    const { key, s } = await connect();
    const res = await t.http
      .post(`/api/widget/${key}/booking`)
      .send({ token: s.token, serviceId: SERVICE, startsAt: TAKEN, idempotencyKey: randomUUID(), name: 'A', email: 'a@example.test', phone: '', consent: true })
      .expect(409);
    expect(res.body.errorCode).toBe('SLOT_TAKEN');
  });

  it('refuses without a Slotwise connection or with another workspace’s token', async () => {
    const plain = await registerOwner(t, 'No Booking');
    const plainKey = await keyOf(t, plain);
    const ps = await widgetSession(t, plainKey);
    await t.http.post(`/api/widget/${plainKey}/booking/services`).send({ token: ps.token }).expect(400);
    const { key } = await connect();
    await t.http.post(`/api/widget/${key}/booking/services`).send({ token: ps.token }).expect(401);
  });

  it('refuses a private Slotwise address when private addresses aren’t allowed', async () => {
    const strict = await startApp({ ALLOW_PRIVATE_URLS: 'false' });
    try {
      const owner = await registerOwner(strict);
      await as(strict, owner).put(`/api/workspaces/${owner.workspaceId}/slotwise`, { baseUrl: slotwiseUrl, apiKey: KEY }).expect(200);
      const key = await keyOf(strict, owner);
      const s = await widgetSession(strict, key);
      const before = received.length;
      const res = await strict.http.post(`/api/widget/${key}/booking/services`).send({ token: s.token }).expect(502);
      expect(res.body.errorCode).toBe('BOOKING_UNAVAILABLE');
      expect(received.length).toBe(before); // never reached
    } finally {
      await strict.close();
    }
  });
});
