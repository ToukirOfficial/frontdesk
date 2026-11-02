import type { ChatMessage } from '@frontdesk/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeChatProvider } from '../src/ai/fake.provider.js';
import { RetentionService } from '../src/insights/retention.service.js';
import { currentMonth } from '../src/insights/usage.service.js';
import { addMember, as, registerOwner, reset, startApp, type TestApp } from './helpers.js';
import { collect, keyOf, listen, say, until, visitorSocket, widgetSession } from './socket-helpers.js';

let t: TestApp;
let base: string;
beforeAll(async () => {
  t = await startApp();
  base = await listen(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await reset(t);
  FakeChatProvider.requests.length = 0;
});

describe('monthly spend cap', () => {
  it('over the cap, the widget switches to leave-a-message and the model is not called', async () => {
    const owner = await registerOwner(t);
    const key = await keyOf(t, owner);
    await as(t, owner).put(`/api/workspaces/${owner.workspaceId}/limits`, { monthlyTokenCap: 1000, retentionDays: 90 }).expect(200);
    expect((await t.http.get(`/api/widget/${key}/config`).expect(200)).body.mode).toBe('chat');

    await t.prisma.usageMonth.create({ data: { workspaceId: owner.workspaceId, month: currentMonth(), inputTokens: 900, outputTokens: 100 } });
    expect((await t.http.get(`/api/widget/${key}/config`).expect(200)).body.mode).toBe('message');

    const s = await widgetSession(t, key);
    const socket = await visitorSocket(base, key, s.token);
    const messages = collect<ChatMessage>(socket, 'message');
    let unavailable = false;
    socket.on('handover:unavailable', () => (unavailable = true));
    try {
      expect((await say(socket, 'What are your prices?')).ok).toBe(true);
      expect(FakeChatProvider.requests).toHaveLength(0);
      await until(() => unavailable);
      expect(messages.at(-1)).toMatchObject({ role: 'system', content: expect.stringContaining('leave a message') });
      // Leaving a message still works.
      await t.http
        .post(`/api/widget/${key}/enquiry`)
        .send({ token: s.token, name: 'A', email: 'a@example.test', phone: '', need: 'Prices please', consent: true })
        .expect(201);
    } finally {
      socket.disconnect();
    }

    const usage = await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/usage`).expect(200);
    expect(usage.body).toMatchObject({ inputTokens: 900, outputTokens: 100, monthlyTokenCap: 1000, mode: 'message', enquiries: 1 });
  });

  it('counts tokens per workspace: one workspace’s usage never caps another', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    await t.prisma.usageMonth.create({ data: { workspaceId: a.workspaceId, month: currentMonth(), inputTokens: 5_000_000, outputTokens: 0 } });
    expect((await t.http.get(`/api/widget/${await keyOf(t, a)}/config`).expect(200)).body.mode).toBe('message');
    expect((await t.http.get(`/api/widget/${await keyOf(t, b)}/config`).expect(200)).body.mode).toBe('chat');
  });

  it('records tokens from each reply', async () => {
    const owner = await registerOwner(t);
    const key = await keyOf(t, owner);
    const s = await widgetSession(t, key);
    const socket = await visitorSocket(base, key, s.token);
    try {
      await say(socket, 'Hello');
      await say(socket, 'Hello again');
    } finally {
      socket.disconnect();
    }
    const usage = await t.prisma.usageMonth.findUniqueOrThrow({ where: { workspaceId_month: { workspaceId: owner.workspaceId, month: currentMonth() } } });
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
  });

  it('only owners and admins change limits, with sensible bounds', async () => {
    const owner = await registerOwner(t);
    const staff = await addMember(t, owner, 'staff');
    const L = `/api/workspaces/${owner.workspaceId}/limits`;
    await as(t, staff).put(L, { monthlyTokenCap: 10, retentionDays: 30 }).expect(403);
    await as(t, owner).put(L, { monthlyTokenCap: -1, retentionDays: 0 }).expect(400);
    await as(t, staff).get(`/api/workspaces/${owner.workspaceId}/usage`).expect(200);
  });
});

describe('retention', () => {
  it('deletes conversations, enquiries and unanswered questions older than each workspace’s period', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    await as(t, a).put(`/api/workspaces/${a.workspaceId}/limits`, { monthlyTokenCap: 2_000_000, retentionDays: 30 }).expect(200);
    const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

    const make = async (workspaceId: string, age: number) => {
      const c = await t.prisma.conversation.create({ data: { workspaceId, visitorId: 'v', lastMessageAt: daysAgo(age), createdAt: daysAgo(age) } });
      await t.prisma.message.create({ data: { workspaceId, conversationId: c.id, role: 'visitor', content: 'hi', createdAt: daysAgo(age) } });
      await t.prisma.enquiry.create({
        data: { workspaceId, conversationId: c.id, name: 'A', need: 'x', consentText: 'ok', consentAt: daysAgo(age), createdAt: daysAgo(age) },
      });
      await t.prisma.unansweredQuestion.create({ data: { workspaceId, conversationId: c.id, question: 'q', createdAt: daysAgo(age) } });
      return c.id;
    };
    const aOld = await make(a.workspaceId, 40); // older than A's 30 days: deleted
    const aNew = await make(a.workspaceId, 10);
    const bMid = await make(b.workspaceId, 40); // B keeps the default 90 days
    const bOld = await make(b.workspaceId, 100);

    const result = await new RetentionService(t.prisma).run();
    expect(result).toEqual({ conversations: 2, enquiries: 2, unanswered: 2 });

    const left = (await t.prisma.conversation.findMany({ select: { id: true } })).map((c) => c.id).sort();
    expect(left).toEqual([aNew, bMid].sort());
    expect(await t.prisma.message.count({ where: { conversationId: { in: [aOld, bOld] } } })).toBe(0);
    expect(await t.prisma.enquiry.count()).toBe(2);
    expect(await t.prisma.unansweredQuestion.count()).toBe(2);
  });
});

describe('insights', () => {
  it('lists enquiries and unanswered questions for members of that workspace only', async () => {
    const owner = await registerOwner(t, 'Workspace A');
    const staff = await addMember(t, owner, 'staff');
    const other = await registerOwner(t, 'Workspace B');
    const c = await t.prisma.conversation.create({ data: { workspaceId: owner.workspaceId, visitorId: 'v' } });
    await t.prisma.enquiry.create({ data: { workspaceId: owner.workspaceId, conversationId: c.id, name: 'Alex', need: 'Call me', consentText: 'ok', consentAt: new Date() } });
    const q = await t.prisma.unansweredQuestion.create({ data: { workspaceId: owner.workspaceId, conversationId: c.id, question: 'Do you treat horses?' } });
    const W = `/api/workspaces/${owner.workspaceId}`;

    expect((await as(t, staff).get(`${W}/enquiries`).expect(200)).body.items).toHaveLength(1);
    expect((await as(t, staff).get(`${W}/unanswered`).expect(200)).body.items).toHaveLength(1);
    await as(t, other).get(`${W}/enquiries`).expect(404);
    await as(t, other).get(`${W}/unanswered`).expect(404);
    expect((await as(t, other).get(`/api/workspaces/${other.workspaceId}/enquiries`).expect(200)).body.items).toEqual([]);

    // Answering: owners and admins only, and never another workspace's question.
    await as(t, staff).post(`${W}/unanswered/${q.id}/answer`, { answer: 'No, people only.' }).expect(403);
    await as(t, other).post(`/api/workspaces/${other.workspaceId}/unanswered/${q.id}/answer`, { answer: 'x' }).expect(404);
    const res = await as(t, owner).post(`${W}/unanswered/${q.id}/answer`, { answer: 'No, people only.' }).expect(200);
    expect(res.body.resolvedAt).not.toBeNull();
    const faq = await t.prisma.knowledgeSource.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, type: 'faq' } });
    expect(faq).toMatchObject({ question: 'Do you treat horses?', content: 'No, people only.', status: 'processing' });
    expect((await as(t, owner).get(`${W}/unanswered`).expect(200)).body.items).toEqual([]);
    expect((await as(t, owner).get(`${W}/unanswered?status=resolved`).expect(200)).body.items).toHaveLength(1);
  });

  it('searches conversations by message text within the workspace', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    const mk = async (workspaceId: string, text: string) => {
      const c = await t.prisma.conversation.create({ data: { workspaceId, visitorId: 'v' } });
      await t.prisma.message.create({ data: { workspaceId, conversationId: c.id, role: 'visitor', content: text } });
      return c.id;
    };
    const parking = await mk(a.workspaceId, 'Is there PARKING nearby?');
    await mk(a.workspaceId, 'What are your prices?');
    await mk(b.workspaceId, 'parking question in another workspace');
    const res = await as(t, a).get(`/api/workspaces/${a.workspaceId}/conversations?q=parking`).expect(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([parking]);
  });
});
