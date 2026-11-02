import { Logger } from '@nestjs/common';
import type { ChatMessage } from '@frontdesk/shared';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoKeyRedisKey } from '../src/ai/ai-resolver.js';
import { FakeChatProvider } from '../src/ai/fake.provider.js';
import { DEMO_LABEL, NO_PROVIDER_NOTE, REPLAY_ONLY_NOTE } from '../src/chat/visitor.gateway.js';
import { JsonLogger } from '../src/common/logger.js';
import { DemoService } from '../src/demo/demo.service.js';
import { replaySet } from '../src/demo/replay.js';
import { addMember, as, nextIp, registerOwner, reset, startApp, type TestApp } from './helpers.js';
import { keyOf, listen, visitorSocket, widgetSession } from './socket-helpers.js';

// Look like real keys; the fake provider rejects any key containing "bad".
const KEY_A = 'sk-test-workspace-a-0000000000000000AAAA';
const KEY_B = 'sk-test-workspace-b-0000000000000000BBBB';
const BAD_KEY = 'sk-test-bad-000000000000000000000000DEAD';
const VISITOR_KEY = 'sk-test-demo-visitor-0000000000000000VVVV';

/** Sends a message and waits for the ack (it comes after any reply), collecting the reply and system notes. */
const ask = (socket: Socket, text: string) =>
  new Promise<{ ack: { ok: boolean; error?: string }; end?: ChatMessage; notes: string[] }>((resolve) => {
    let end: ChatMessage | undefined;
    const notes: string[] = [];
    const onEnd = (m: ChatMessage) => (end = m);
    const onMsg = (m: ChatMessage) => m.role === 'system' && notes.push(m.content);
    socket.on('reply:end', onEnd);
    socket.on('message', onMsg);
    socket.emit('message', { text }, (ack: { ok: boolean; error?: string }) => {
      socket.off('reply:end', onEnd);
      socket.off('message', onMsg);
      resolve({ ack, end, notes });
    });
  });

const setKey = (t: TestApp, s: { cookie: string; workspaceId: string }, body: object) => as(t, s).put(`/api/workspaces/${s.workspaceId}/ai`, body);

describe('no AI key at all', () => {
  let t: TestApp;
  let base: string;
  beforeAll(async () => {
    t = await startApp({ AI_PROVIDER: '' });
    base = await listen(t);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await reset(t);
    FakeChatProvider.requests.length = 0;
  });

  it('boots, and an incomplete instance setting (provider without key or model) still boots', async () => {
    await t.http.get('/api/health').expect(200);
    const half = await startApp({ AI_PROVIDER: 'anthropic', AI_MODEL: '', AI_API_KEY: '' });
    await half.http.get('/api/health').expect(200);
    await half.close();
  });

  it('the widget says no provider is configured, the dashboard shows the setup state, and nothing calls a model', async () => {
    const owner = await registerOwner(t);
    const key = await keyOf(t, owner);
    expect((await t.http.get(`/api/widget/${key}/config`).expect(200)).body).toMatchObject({ ai: 'none', suggestions: [] });
    expect((await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/usage`).expect(200)).body.ai).toBe('none');
    expect((await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/ai`).expect(200)).body).toEqual({
      workspace: null,
      instance: null,
      active: 'none',
    });

    const s = await widgetSession(t, key);
    const socket = await visitorSocket(base, key, s.token);
    const res = await ask(socket, 'What are your prices?');
    socket.disconnect();
    expect(res.ack.ok).toBe(true);
    expect(res.end).toBeUndefined();
    expect(res.notes).toEqual([NO_PROVIDER_NOTE]);
    expect(FakeChatProvider.requests).toHaveLength(0);
    // Leave a message still works.
    await t.http
      .post(`/api/widget/${key}/enquiry`)
      .set('X-Forwarded-For', nextIp())
      .send({ token: s.token, name: 'Test Visitor', email: 'visitor@example.test', phone: '', need: 'Call me', consent: true })
      .expect(201);
  });

  it('a workspace key switches that workspace on, and only that one', async () => {
    const a = await registerOwner(t, 'Shop A');
    const b = await registerOwner(t, 'Shop B');
    await setKey(t, a, { provider: 'anthropic', model: 'test-model', apiKey: KEY_A }).expect(200);
    const keyA = await keyOf(t, a);
    const keyB = await keyOf(t, b);
    expect((await t.http.get(`/api/widget/${keyA}/config`).expect(200)).body.ai).toBe('ready');
    expect((await t.http.get(`/api/widget/${keyB}/config`).expect(200)).body.ai).toBe('none');

    const sb = await widgetSession(t, keyB);
    const socket = await visitorSocket(base, keyB, sb.token);
    const res = await ask(socket, 'Hello');
    socket.disconnect();
    expect(res.notes).toEqual([NO_PROVIDER_NOTE]);
    expect(FakeChatProvider.requests).toHaveLength(0); // B never borrows A's key
  });
});

describe('workspace keys (bring your own key)', () => {
  let t: TestApp;
  let base: string;
  beforeAll(async () => {
    t = await startApp(); // with an instance provider (the fake one), so overriding it can be checked
    base = await listen(t);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await reset(t);
    FakeChatProvider.requests.length = 0;
    FakeChatProvider.pings.length = 0;
  });

  it('is write-only: encrypted at rest, never returned, only the last 4 characters shown', async () => {
    const owner = await registerOwner(t);
    const put = await setKey(t, owner, { provider: 'openai', model: 'test-model', apiKey: KEY_A }).expect(200);
    const get = await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/ai`).expect(200);
    for (const res of [put, get]) {
      expect(JSON.stringify(res.body)).not.toContain(KEY_A.slice(0, 20));
      expect(res.body.workspace).toMatchObject({ provider: 'openai', model: 'test-model', keyLast4: 'AAAA', baseUrl: null });
      expect(res.body.active).toBe('workspace');
    }
    const row = await t.prisma.aiSettings.findUniqueOrThrow({ where: { workspaceId: owner.workspaceId } });
    expect(row.keyCipher).toBeTruthy();
    expect(row.keyCipher).not.toContain(KEY_A);
    // Nothing else about the workspace leaks it either.
    const usage = await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/usage`).expect(200);
    expect(usage.body.ai).toBe('workspace');
    expect(JSON.stringify(usage.body)).not.toContain('AAAA');
    const assistant = await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/assistant`).expect(200);
    expect(JSON.stringify(assistant.body)).not.toContain(KEY_A);
  });

  it('overrides the instance key; removing it falls back to the instance key', async () => {
    const owner = await registerOwner(t);
    const key = await keyOf(t, owner);
    await setKey(t, owner, { provider: 'gemini', model: 'test-model', apiKey: KEY_A }).expect(200);
    const s = await widgetSession(t, key);
    const socket = await visitorSocket(base, key, s.token);
    expect((await ask(socket, 'Hello')).end?.role).toBe('assistant');
    expect(FakeChatProvider.requests.at(-1)).toMatchObject({ apiKey: KEY_A, model: 'test-model' });

    const removed = await as(t, owner).delete(`/api/workspaces/${owner.workspaceId}/ai`).expect(200);
    expect(removed.body).toMatchObject({ workspace: null, active: 'instance' });
    await ask(socket, 'Hello again');
    socket.disconnect();
    expect(FakeChatProvider.requests.at(-1)?.apiKey).toBe(''); // the instance's (fake) provider
    expect(await t.prisma.aiSettings.count()).toBe(0);
  });

  it('keeps the saved key when only the model changes, but wants a new key for a new provider', async () => {
    const owner = await registerOwner(t);
    await setKey(t, owner, { provider: 'anthropic', model: 'model-one' }).expect(400); // no key yet
    await setKey(t, owner, { provider: 'anthropic', model: 'model-one', apiKey: KEY_A }).expect(200);
    const kept = await setKey(t, owner, { provider: 'anthropic', model: 'model-two' }).expect(200);
    expect(kept.body.workspace).toMatchObject({ model: 'model-two', keyLast4: 'AAAA' });
    const res = await setKey(t, owner, { provider: 'openai', model: 'model-two' }).expect(400);
    expect(res.body.fields.apiKey).toBeTruthy();
  });

  it('OpenAI-compatible endpoints: key optional, model from config, and private addresses are refused (SSRF)', async () => {
    const owner = await registerOwner(t);
    for (const baseUrl of ['http://127.0.0.1:11434/v1', 'http://169.254.169.254/v1', 'http://10.0.0.5/v1']) {
      const res = await setKey(t, owner, { provider: 'openai-compatible', model: 'llama3.1:8b', baseUrl }).expect(400);
      expect(res.body.errorCode).toBe('URL_REJECTED');
    }
    await setKey(t, owner, { provider: 'openai-compatible', model: 'llama3.1:8b' }).expect(400); // address required
    const ok = await setKey(t, owner, { provider: 'openai-compatible', model: 'llama3.1:8b', baseUrl: 'http://93.184.215.14/v1/' }).expect(200);
    expect(ok.body.workspace).toMatchObject({ provider: 'openai-compatible', baseUrl: 'http://93.184.215.14/v1', keyLast4: null });
    expect(ok.body.active).toBe('workspace');
  });

  it('Test key makes one tiny request and never echoes the provider’s error (which can contain the key)', async () => {
    const owner = await registerOwner(t);
    const path = `/api/workspaces/${owner.workspaceId}/ai/test`;
    const bad = await as(t, owner).post(path, { provider: 'anthropic', model: 'm', apiKey: BAD_KEY }).expect(200);
    expect(bad.body.ok).toBe(false);
    expect(bad.body.message).toMatch(/rejected this key/);
    expect(JSON.stringify(bad.body)).not.toContain(BAD_KEY);
    expect(await t.prisma.aiSettings.count()).toBe(0); // testing never saves

    await as(t, owner).post(path, {}).expect(400); // nothing saved to test
    await setKey(t, owner, { provider: 'anthropic', model: 'm', apiKey: KEY_A }).expect(200);
    expect((await as(t, owner).post(path, {}).expect(200)).body.ok).toBe(true);
    expect((await as(t, owner).post(path, { provider: 'anthropic', model: 'other' }).expect(200)).body.ok).toBe(true); // saved key
    expect(FakeChatProvider.pings).toEqual([BAD_KEY, KEY_A, KEY_A]);
  });

  it('owners and admins manage it; staff and other workspaces can’t read or change it', async () => {
    const owner = await registerOwner(t);
    const admin = await addMember(t, owner, 'admin');
    const staff = await addMember(t, owner, 'staff');
    const other = await registerOwner(t, 'Other');
    const path = `/api/workspaces/${owner.workspaceId}/ai`;
    await as(t, admin).put(path, { provider: 'openai', model: 'm', apiKey: KEY_A }).expect(200);
    await as(t, staff).get(path).expect(403);
    await as(t, staff).put(path, { provider: 'openai', model: 'm', apiKey: KEY_B }).expect(403);
    await as(t, staff).post(`${path}/test`, {}).expect(403);
    for (const res of [await as(t, other).get(path), await as(t, other).put(path, { provider: 'openai', model: 'm', apiKey: KEY_B }), await as(t, other).delete(path)]) {
      expect([403, 404]).toContain(res.status);
    }
    const row = await t.prisma.aiSettings.findUniqueOrThrow({ where: { workspaceId: owner.workspaceId } });
    expect(row.keyLast4).toBe('AAAA'); // unchanged
  });

  it('a workspace can never use another workspace’s key', async () => {
    const a = await registerOwner(t, 'Shop A');
    const b = await registerOwner(t, 'Shop B');
    const c = await registerOwner(t, 'Shop C');
    await setKey(t, a, { provider: 'openai', model: 'model-a', apiKey: KEY_A }).expect(200);
    await setKey(t, b, { provider: 'openai', model: 'model-b', apiKey: KEY_B }).expect(200);
    for (const [ws, expected] of [
      [a, KEY_A],
      [b, KEY_B],
      [c, ''], // no key of its own: the instance's, never A's or B's
    ] as const) {
      const key = await keyOf(t, ws);
      const s = await widgetSession(t, key);
      const socket = await visitorSocket(base, key, s.token);
      await ask(socket, 'Hello');
      socket.disconnect();
      expect(FakeChatProvider.requests.at(-1)?.apiKey).toBe(expected);
    }
    // A visitor token for A can't be used on B's widget either (it starts a fresh B conversation).
    const keyB = await keyOf(t, b);
    const sa = await widgetSession(t, await keyOf(t, a));
    const resumed = await t.http.post(`/api/widget/${keyB}/session`).send({ token: sa.token }).expect(200);
    expect(resumed.body.conversationId).not.toBe(sa.conversationId);
  });

  it('the monthly spend cap still applies to a workspace’s own key', async () => {
    const owner = await registerOwner(t);
    await setKey(t, owner, { provider: 'openai', model: 'm', apiKey: KEY_A }).expect(200);
    await t.prisma.workspace.update({ where: { id: owner.workspaceId }, data: { monthlyTokenCap: 0 } });
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    const socket = await visitorSocket(base, key, s.token);
    const res = await ask(socket, 'Hello');
    socket.disconnect();
    expect(res.end).toBeUndefined();
    expect(FakeChatProvider.requests).toHaveLength(0);
  });
});

describe('keys never reach the logs', () => {
  let t: TestApp;
  let base: string;
  const lines: string[] = [];
  let restore: () => void;
  beforeAll(async () => {
    t = await startApp();
    base = await listen(t);
    // The production JSON logger, writing to captured stdout/stderr.
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    const grab = (chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    };
    process.stdout.write = grab as typeof process.stdout.write;
    process.stderr.write = grab as typeof process.stderr.write;
    Logger.overrideLogger(new JsonLogger(['error', 'warn', 'log', 'debug']));
    restore = () => {
      process.stdout.write = out;
      process.stderr.write = err;
      Logger.overrideLogger(false);
    };
  });
  afterAll(async () => {
    restore();
    await t.close();
  });

  it('saving, testing and failing with a key logs only fixed categories', async () => {
    await reset(t);
    const owner = await registerOwner(t);
    await setKey(t, owner, { provider: 'openai', model: 'm', apiKey: KEY_A }).expect(200);
    await as(t, owner).post(`/api/workspaces/${owner.workspaceId}/ai/test`, { provider: 'openai', model: 'm', apiKey: BAD_KEY }).expect(200);
    // A saved key the provider rejects: the reply fails, and the provider's error (which echoes the key) is logged
    // only as a category.
    await setKey(t, owner, { provider: 'openai', model: 'm', apiKey: BAD_KEY }).expect(200);
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    const socket = await visitorSocket(base, key, s.token);
    const res = await ask(socket, 'Hello');
    socket.disconnect();
    expect(res.end?.content).toMatch(/can’t answer right now/);

    const all = lines.join('\n');
    expect(all).toContain('AI provider saved'); // the capture works
    expect(all).toContain('Reply failed in workspace');
    expect(all).toContain('bad_key');
    for (const k of [KEY_A, BAD_KEY]) {
      expect(all).not.toContain(k);
      expect(all).not.toContain(k.slice(8, 28)); // not even a fragment
    }
  });
});

describe('the public demo: replay, and visitors’ own keys', () => {
  let t: TestApp;
  let base: string;
  let key: string;
  beforeAll(async () => {
    t = await startApp({ DEMO_MODE: 'true' }); // the instance has a provider, and the demo must still not use it
    base = await listen(t);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await reset(t);
    FakeChatProvider.requests.length = 0;
    await t.app.get(DemoService).seed();
    key = (await t.http.get('/api/demo').expect(200)).body.publicKey;
  });

  const addKey = (token: string, apiKey = VISITOR_KEY) =>
    t.http.post(`/api/widget/${key}/demo-key`).set('X-Forwarded-For', nextIp()).send({ token, provider: 'anthropic', model: 'test-model', apiKey });

  it('replays labelled sample answers for the suggested questions, at no cost, and never the instance key', async () => {
    const cfg = (await t.http.get(`/api/widget/${key}/config`).expect(200)).body;
    expect(cfg.ai).toBe('replay');
    expect(cfg.suggestions).toEqual(replaySet().items.map((i) => i.question));
    const s = await widgetSession(t, key);
    const socket = await visitorSocket(base, key, s.token);
    const first = await ask(socket, cfg.suggestions[0]);
    expect(first.end).toMatchObject({ role: 'assistant', authorName: DEMO_LABEL, content: replaySet().items[0]!.answer });
    const free = await ask(socket, 'Something nobody suggested');
    expect(free.end).toBeUndefined();
    expect(free.notes).toEqual([REPLAY_ONLY_NOTE]);
    // The "don't know" sample answer fills the real Unanswered list.
    const unknown = replaySet().items.find((i) => i.unanswered)!;
    await ask(socket, unknown.question);
    socket.disconnect();
    expect(await t.prisma.unansweredQuestion.count()).toBe(1);
    expect(FakeChatProvider.requests).toHaveLength(0);
    expect(await t.prisma.usageMonth.count()).toBe(0);
  });

  it('a visitor’s own key: tested first, encrypted, tied to their chat, never returned', async () => {
    const s = await widgetSession(t, key);
    const bad = await addKey(s.token, BAD_KEY).expect(400);
    expect(bad.body.errorCode).toBe('AI_KEY_REJECTED');
    expect(JSON.stringify(bad.body)).not.toContain(BAD_KEY);
    expect(await t.redis.client.get(demoKeyRedisKey(s.conversationId))).toBeNull();

    const ok = await addKey(s.token).expect(201);
    expect(ok.body).toEqual({ provider: 'anthropic', model: 'test-model', keyLast4: 'VVVV' });
    const sealed = await t.redis.client.get(demoKeyRedisKey(s.conversationId));
    expect(sealed).toBeTruthy();
    expect(sealed).not.toContain(VISITOR_KEY.slice(8));
    const resumed = await t.http.post(`/api/widget/${key}/session`).send({ token: s.token }).expect(200);
    expect(resumed.body.demoKey).toEqual({ provider: 'anthropic', model: 'test-model', keyLast4: 'VVVV' });
    expect(JSON.stringify(resumed.body)).not.toContain(VISITOR_KEY);

    const socket = await visitorSocket(base, key, s.token);
    const live = await ask(socket, 'Anything at all');
    socket.disconnect();
    expect(live.end?.authorName).toBeNull();
    expect(FakeChatProvider.requests.at(-1)?.apiKey).toBe(VISITOR_KEY);

    // Another visitor's chat is unaffected.
    const other = await widgetSession(t, key);
    expect((await t.http.post(`/api/widget/${key}/session`).send({ token: other.token }).expect(200)).body.demoKey).toBeNull();
  });

  it('demo keys expire after 24 hours and are deleted (TTL, remove button, nightly reset)', async () => {
    const s = await widgetSession(t, key);
    await addKey(s.token).expect(201);
    const ttl = await t.redis.client.ttl(demoKeyRedisKey(s.conversationId));
    expect(ttl).toBeGreaterThan(24 * 60 * 60 - 60);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);

    // Time passes: Redis deletes the key, and the chat is back to replay.
    await t.redis.client.pexpire(demoKeyRedisKey(s.conversationId), 50);
    await new Promise((r) => setTimeout(r, 120));
    expect(await t.redis.client.exists(demoKeyRedisKey(s.conversationId))).toBe(0);
    expect((await t.http.post(`/api/widget/${key}/session`).send({ token: s.token }).expect(200)).body.demoKey).toBeNull();
    const socket = await visitorSocket(base, key, s.token);
    expect((await ask(socket, 'Anything at all')).notes).toEqual([REPLAY_ONLY_NOTE]);
    socket.disconnect();

    // Remove my key.
    await addKey(s.token).expect(201);
    await t.http.delete(`/api/widget/${key}/demo-key`).send({ token: s.token }).expect(200);
    expect(await t.redis.client.exists(demoKeyRedisKey(s.conversationId))).toBe(0);

    // The nightly reset removes every visitor key.
    const s2 = await widgetSession(t, key);
    await addKey(s.token).expect(201);
    await addKey(s2.token).expect(201);
    await t.app.get(DemoService).reset();
    expect(await t.redis.client.exists(demoKeyRedisKey(s.conversationId), demoKeyRedisKey(s2.conversationId))).toBe(0);
  });

  it('strict limits, and only the demo clinic accepts visitor keys', async () => {
    const s = await widgetSession(t, key);
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      await t.http.post(`/api/widget/${key}/demo-key`).set('X-Forwarded-For', ip).send({ token: s.token, provider: 'openai', model: 'm', apiKey: VISITOR_KEY }).expect(201);
    }
    await t.http.post(`/api/widget/${key}/demo-key`).set('X-Forwarded-For', ip).send({ token: s.token, provider: 'openai', model: 'm', apiKey: VISITOR_KEY }).expect(429);
    // OpenAI-compatible (custom addresses) isn't offered to demo visitors.
    await addKey(s.token).expect(201);
    await t.http
      .post(`/api/widget/${key}/demo-key`)
      .set('X-Forwarded-For', nextIp())
      .send({ token: s.token, provider: 'openai-compatible', model: 'm', apiKey: VISITOR_KEY })
      .expect(400);
    // A token from elsewhere is refused.
    await t.http.post(`/api/widget/${key}/demo-key`).set('X-Forwarded-For', nextIp()).send({ token: 'x'.repeat(40), provider: 'openai', model: 'm', apiKey: VISITOR_KEY }).expect(401);
  });
});

describe('visitor keys outside the demo', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());
  beforeEach(() => reset(t));

  it('a normal workspace has no demo-key route', async () => {
    const owner = await registerOwner(t);
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    await t.http.post(`/api/widget/${key}/demo-key`).send({ token: s.token, provider: 'openai', model: 'm', apiKey: VISITOR_KEY }).expect(404);
    expect((await t.http.post(`/api/widget/${key}/session`).send({ token: s.token }).expect(200)).body.demoKey).toBeNull();
  });
});
