import type { ChatMessage, ConversationSummary } from '@frontdesk/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeChatProvider } from '../src/ai/fake.provider.js';
import { addMember, as, registerOwner, reset, startApp, type TestApp } from './helpers.js';
import { collect, keyOf, listen, say, staffSocket, until, visitorSocket, widgetSession } from './socket-helpers.js';

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

const C = (workspaceId: string, conversationId: string) => `/api/workspaces/${workspaceId}/conversations/${conversationId}`;

/** A workspace with an owner, a staff member and one visitor conversation that has a message. */
const setup = async () => {
  const owner = await registerOwner(t);
  const staff = await addMember(t, owner, 'staff');
  const key = await keyOf(t, owner);
  const session = await widgetSession(t, key);
  const visitor = await visitorSocket(base, key, session.token);
  await say(visitor, 'Hello, is anyone there?');
  return { owner, staff, key, session, visitor };
};

describe('takeover', () => {
  it('two people taking over at once: exactly one wins', async () => {
    const { owner, staff, session, visitor } = await setup();
    try {
      const results = await Promise.all([
        as(t, owner).post(`${C(owner.workspaceId, session.conversationId)}/takeover`),
        as(t, staff).post(`${C(owner.workspaceId, session.conversationId)}/takeover`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(results.find((r) => r.status === 409)?.body.errorCode).toBe('ALREADY_TAKEN');
      const conv = await t.prisma.conversation.findUniqueOrThrow({ where: { id: session.conversationId } });
      const winner = results.find((r) => r.status === 200)!;
      expect(conv.mode).toBe('human');
      expect(conv.assignedUserId).toBe(winner.body.assignedUserId);
    } finally {
      visitor.disconnect();
    }
  });

  it('the visitor is told who they’re talking to, the assistant goes quiet, and staff replies reach them', async () => {
    const { staff, owner, session, visitor } = await setup();
    const messages = collect<ChatMessage>(visitor, 'message');
    const modes = collect<{ mode: string; staffName: string | null }>(visitor, 'mode');
    try {
      await as(t, staff).post(`${C(owner.workspaceId, session.conversationId)}/takeover`).expect(200);
      await until(() => modes.length === 1);
      expect(modes[0]).toEqual({ mode: 'human', staffName: 'staff person' });
      expect(messages.at(-1)).toMatchObject({ role: 'system', content: 'You’re now chatting with staff person.' });

      const before = FakeChatProvider.requests.length;
      expect((await say(visitor, 'Can I speak to someone?')).ok).toBe(true);
      expect(FakeChatProvider.requests.length).toBe(before); // no AI reply while a person has the chat

      await as(t, staff).post(`${C(owner.workspaceId, session.conversationId)}/messages`, { text: 'Hi, it’s Sam here.' }).expect(201);
      await until(() => messages.some((m) => m.role === 'staff'));
      expect(messages.find((m) => m.role === 'staff')).toMatchObject({ content: 'Hi, it’s Sam here.', authorName: 'staff person' });

      await as(t, staff).post(`${C(owner.workspaceId, session.conversationId)}/handback`).expect(200);
      await until(() => modes.length === 2);
      expect(modes[1]).toEqual({ mode: 'ai', staffName: null });
      await say(visitor, 'Thanks');
      expect(FakeChatProvider.requests.length).toBe(before + 1); // the assistant answers again
    } finally {
      visitor.disconnect();
    }
  });

  it('only the person who took over can reply; owners and admins can hand back', async () => {
    const { owner, staff, session, visitor } = await setup();
    const staff2 = await addMember(t, owner, 'staff');
    try {
      await as(t, staff).post(`${C(owner.workspaceId, session.conversationId)}/messages`, { text: 'Too early' }).expect(409);
      await as(t, staff).post(`${C(owner.workspaceId, session.conversationId)}/takeover`).expect(200);
      const r = await as(t, staff2).post(`${C(owner.workspaceId, session.conversationId)}/messages`, { text: 'Me too' }).expect(409);
      expect(r.body.errorCode).toBe('NOT_ASSIGNED');
      await as(t, staff2).post(`${C(owner.workspaceId, session.conversationId)}/handback`).expect(409);
      await as(t, owner).post(`${C(owner.workspaceId, session.conversationId)}/handback`).expect(200);
    } finally {
      visitor.disconnect();
    }
  });

  it('another workspace can’t see, take over or write in a conversation', async () => {
    const { owner, session, visitor } = await setup();
    const other = await registerOwner(t, 'Other Workspace');
    try {
      await as(t, other).get(`${C(other.workspaceId, session.conversationId)}`).expect(404);
      await as(t, other).post(`${C(other.workspaceId, session.conversationId)}/takeover`).expect(404);
      await as(t, other).post(`${C(other.workspaceId, session.conversationId)}/messages`, { text: 'x' }).expect(404);
      await as(t, other).get(`${C(owner.workspaceId, session.conversationId)}`).expect(404);
      const list = await as(t, other).get(`/api/workspaces/${other.workspaceId}/conversations`).expect(200);
      expect(list.body.items).toEqual([]);
      const mine = await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/conversations`).expect(200);
      expect(mine.body.items.map((c: ConversationSummary) => c.id)).toEqual([session.conversationId]);
    } finally {
      visitor.disconnect();
    }
  });
});

describe('asking for a person', () => {
  it('with nobody online, it becomes an enquiry', async () => {
    const { visitor } = await setup();
    let unavailable = false;
    visitor.on('handover:unavailable', () => (unavailable = true));
    try {
      const res = (await visitor.emitWithAck('handover')) as { ok: boolean; available: boolean };
      expect(res).toEqual({ ok: true, available: false });
      await until(() => unavailable);
    } finally {
      visitor.disconnect();
    }
  });

  it('with staff online, they are alerted in real time', async () => {
    const { owner, staff, session, visitor } = await setup();
    const dashboard = await staffSocket(base, staff.cookie, owner.workspaceId);
    const alerts = collect<ConversationSummary>(dashboard, 'handover:requested');
    try {
      const res = (await visitor.emitWithAck('handover')) as { ok: boolean; available: boolean };
      expect(res).toEqual({ ok: true, available: true });
      await until(() => alerts.length === 1);
      expect(alerts[0]).toMatchObject({ id: session.conversationId, handoverRequested: true, mode: 'ai' });
    } finally {
      dashboard.disconnect();
      visitor.disconnect();
    }
  });

  it('staff sockets need the dashboard origin, a login, and membership of the workspace', async () => {
    const { owner } = await setup();
    const other = await registerOwner(t, 'Other Workspace');
    await expect(staffSocket(base, owner.cookie, owner.workspaceId, 'https://evil.example')).rejects.toThrow();
    await expect(staffSocket(base, 'fd_access=nope', owner.workspaceId)).rejects.toThrow();
    await expect(staffSocket(base, other.cookie, owner.workspaceId)).rejects.toThrow('join refused');
  });

  it('staff of another workspace never receive this workspace’s messages', async () => {
    const { key } = await setup();
    const other = await registerOwner(t, 'Other Workspace');
    const dashboard = await staffSocket(base, other.cookie, other.workspaceId);
    const leaked: unknown[] = [];
    dashboard.onAny((e, p) => leaked.push([e, p]));
    const s = await widgetSession(t, key);
    const v = await visitorSocket(base, key, s.token);
    try {
      await say(v, 'Private question');
      await new Promise((r) => setTimeout(r, 100));
      expect(leaked).toEqual([]);
    } finally {
      v.disconnect();
      dashboard.disconnect();
    }
  });
});

describe('staff socket origin', () => {
  it('accepts a same-origin request without an Origin header (what browsers send for polling)', async () => {
    const owner = await registerOwner(t);
    const { io } = await import('socket.io-client');
    const socket = io(`${base}/staff`, {
      path: '/api/socket.io',
      addTrailingSlash: false,
      forceNew: true,
      reconnection: false,
      transports: ['polling'],
      extraHeaders: { cookie: owner.cookie },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', reject);
      });
      expect(await socket.emitWithAck('join', { workspaceId: owner.workspaceId })).toEqual({ ok: true });
    } finally {
      socket.disconnect();
    }
  });
});
