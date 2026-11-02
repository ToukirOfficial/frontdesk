import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clientIp } from '../src/chat/client-ip.js';
import { AiResolver } from '../src/ai/ai-resolver.js';
import { DemoService } from '../src/demo/demo.service.js';
import { KNOWLEDGE_QUEUE } from '../src/queues.js';
import { redisOptions } from '../src/redis/redis.service.js';
import { as, cookiesOf, nextIp, ORIGIN, PASSWORD, registerOwner, reset, startApp, type TestApp } from './helpers.js';

describe('demo mode', () => {
  let t: TestApp;
  let demo: DemoService;
  let queue: Queue;
  beforeAll(async () => {
    t = await startApp({ DEMO_MODE: 'true', DEMO_MONTHLY_TOKEN_CAP: '50000' });
    queue = new Queue(KNOWLEDGE_QUEUE, { connection: redisOptions(t.config.REDIS_URL), prefix: `${t.config.REDIS_PREFIX}:bull` });
    demo = new DemoService(t.prisma, t.redis, queue as never, t.config, t.app.get(AiResolver));
  });
  afterAll(async () => {
    await queue.close();
    await t.close();
  });
  beforeEach(() => reset(t));

  it('switches off sign-up', async () => {
    const res = await t.http
      .post('/api/auth/register')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', nextIp())
      .send({ workspaceName: 'Sneaky', name: 'A', email: 'a@example.test', password: PASSWORD })
      .expect(403);
    expect(res.body.errorCode).toBe('DEMO_MODE');
  });

  it('seeds the fictional clinic once, with a hard cap, and serves its widget key', async () => {
    await t.http.get('/api/demo').expect(404); // nothing seeded yet
    const id = await demo.seed();
    expect(await demo.seed()).toBe(id); // idempotent
    const ws = await t.prisma.workspace.findUniqueOrThrow({ where: { id } });
    expect(ws).toMatchObject({ isDemo: true, monthlyTokenCap: 50000 });
    expect(await t.prisma.knowledgeSource.count({ where: { workspaceId: id } })).toBeGreaterThan(5);
    const res = await t.http.get('/api/demo').expect(200);
    expect(res.body).toEqual({ publicKey: ws.publicKey });
    const cfg = await t.http.get(`/api/widget/${ws.publicKey}/config`).expect(200);
    expect(cfg.body.name).toBe('Riverside Physio (demo)');
  });

  it('the nightly reset clears visitors’ data and restores the settings', async () => {
    const id = await demo.seed();
    const c = await t.prisma.conversation.create({ data: { workspaceId: id, visitorId: 'v' } });
    await t.prisma.unansweredQuestion.create({ data: { workspaceId: id, conversationId: c.id, question: 'q' } });
    await t.prisma.assistantSettings.update({ where: { workspaceId: id }, data: { rules: 'Changed by someone' } });
    await demo.reset();
    expect(await t.prisma.conversation.count({ where: { workspaceId: id } })).toBe(0);
    expect(await t.prisma.unansweredQuestion.count({ where: { workspaceId: id } })).toBe(0);
    const a = await t.prisma.assistantSettings.findUniqueOrThrow({ where: { workspaceId: id } });
    expect(a.rules).not.toBe('Changed by someone');
  });
});

describe('the demo dashboard', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp({ DEMO_MODE: 'true' });
  });
  afterAll(() => t.close());
  beforeEach(() => reset(t));

  it('one button signs in as an admin of the demo clinic only, with no password or code', async () => {
    await t.http.post('/api/auth/demo').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).expect(404); // not seeded yet
    const id = await t.app.get(DemoService).seed();
    const res = await t.http.post('/api/auth/demo').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).expect(200);
    const cookie = cookiesOf(res);
    const list = await t.http.get('/api/workspaces').set('Cookie', cookie).expect(200);
    expect(list.body.items).toEqual([expect.objectContaining({ id, role: 'admin', isDemo: true })]);
    // Admin, not owner: can't delete the workspace.
    await as(t, { cookie }).delete(`/api/workspaces/${id}`).expect(403);
    // The shared account can't be logged into with a password.
    await t.http
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .set('X-Forwarded-For', nextIp())
      .send({ email: 'demo@frontdesk.example', password: PASSWORD })
      .expect(401);
  });

  it('no avatar or file uploads, and the nightly reset restores the knowledge too', async () => {
    const id = await t.app.get(DemoService).seed();
    const cookie = cookiesOf(await t.http.post('/api/auth/demo').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).expect(200));
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000000500010d0a2db40000000049454e44ae426082', 'hex');
    const avatar = await t.http.post(`/api/workspaces/${id}/widget/avatar`).set('Origin', ORIGIN).set('Cookie', cookie).attach('file', png, 'a.png');
    expect(avatar.body.errorCode).toBe('DEMO_MODE');
    const upload = await t.http.post(`/api/workspaces/${id}/knowledge/upload`).set('Origin', ORIGIN).set('Cookie', cookie).attach('file', Buffer.from('%PDF-1.4\n'), 'a.pdf');
    expect(upload.body.errorCode).toBe('DEMO_MODE');

    const before = await t.prisma.knowledgeSource.count({ where: { workspaceId: id } });
    await t.prisma.knowledgeSource.deleteMany({ where: { workspaceId: id, type: 'faq' } });
    await t.prisma.knowledgeSource.create({ data: { workspaceId: id, type: 'text', title: 'Defaced', content: 'Something rude' } });
    await t.app.get(DemoService).reset();
    expect(await t.prisma.knowledgeSource.count({ where: { workspaceId: id } })).toBe(before);
    expect(await t.prisma.knowledgeSource.count({ where: { workspaceId: id, title: 'Defaced' } })).toBe(0);
  });

  it('the demo widget works whatever a visitor types into allowed sites', async () => {
    const id = await t.app.get(DemoService).seed();
    await t.prisma.workspace.update({ where: { id }, data: { allowedOrigins: ['https://elsewhere.example'] } });
    const key = (await t.http.get('/api/demo').expect(200)).body.publicKey;
    await t.redis.del(`widget:${key}`);
    await t.http.get(`/api/widget/${key}/config`).set('Origin', ORIGIN).expect(200);
  });
});

describe('without demo mode', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());
  beforeEach(() => reset(t));

  it('has no demo endpoint and allows sign-up and new workspaces', async () => {
    await t.http.get('/api/demo').expect(404);
    await t.http.post('/api/auth/demo').set('Origin', ORIGIN).set('X-Forwarded-For', nextIp()).expect(404);
    const owner = await registerOwner(t);
    await as(t, owner).post('/api/workspaces', { name: 'Second shop' }).expect(201);
  });
});

describe('client IP behind proxies', () => {
  it('ignores X-Forwarded-For from an untrusted peer', () => {
    expect(clientIp('203.0.113.9', '1.2.3.4')).toBe('203.0.113.9');
    expect(clientIp('10.0.0.5', '1.2.3.4')).toBe('10.0.0.5'); // private peer not trusted by default
  });
  it('takes the address the trusted proxy saw, not one the client wrote', () => {
    expect(clientIp('127.0.0.1', '1.2.3.4')).toBe('1.2.3.4');
    // The client sent "X-Forwarded-For: 9.9.9.9"; our proxy appended the real address.
    expect(clientIp('::ffff:127.0.0.1', '9.9.9.9, 198.51.100.7')).toBe('198.51.100.7');
    // docker compose: web container (private) in front of the API.
    expect(clientIp('172.18.0.4', '9.9.9.9, 198.51.100.7', true)).toBe('198.51.100.7');
    expect(clientIp('172.18.0.4', '198.51.100.7, 172.18.0.1', true)).toBe('198.51.100.7');
  });
});
