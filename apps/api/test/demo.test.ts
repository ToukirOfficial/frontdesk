import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clientIp } from '../src/chat/client-ip.js';
import { AiResolver } from '../src/ai/ai-resolver.js';
import { DemoService } from '../src/demo/demo.service.js';
import { KNOWLEDGE_QUEUE } from '../src/queues.js';
import { redisOptions } from '../src/redis/redis.service.js';
import { nextIp, ORIGIN, PASSWORD, registerOwner, reset, startApp, type TestApp, as } from './helpers.js';

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

describe('without demo mode', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());
  beforeEach(() => reset(t));

  it('has no demo endpoint and allows sign-up and new workspaces', async () => {
    await t.http.get('/api/demo').expect(404);
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
