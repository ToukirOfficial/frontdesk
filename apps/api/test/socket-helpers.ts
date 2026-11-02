import type { AddressInfo } from 'node:net';
import type { ChatMessage } from '@frontdesk/shared';
import { io, type Socket } from 'socket.io-client';
import { as, ORIGIN, type TestApp } from './helpers.js';

export const listen = async (t: TestApp): Promise<string> => {
  await t.app.listen(0, '127.0.0.1');
  return `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;
};

export const keyOf = async (t: TestApp, s: { cookie: string; workspaceId: string }): Promise<string> =>
  (await as(t, s).get(`/api/workspaces/${s.workspaceId}/assistant`).expect(200)).body.widget.publicKey;

export const widgetSession = async (t: TestApp, key: string): Promise<{ token: string; conversationId: string }> =>
  (await t.http.post(`/api/widget/${key}/session`).send({}).expect(200)).body;

const open = (url: string, opts: Parameters<typeof io>[1]): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = io(url, { path: '/api/socket.io', addTrailingSlash: false, transports: ['websocket'], reconnection: false, forceNew: true, ...opts });
    socket.on('connect', () => setTimeout(() => (socket.connected ? resolve(socket) : reject(new Error('disconnected'))), 150));
    socket.on('disconnect', () => reject(new Error('disconnected')));
    socket.on('connect_error', reject);
  });

export const visitorSocket = (base: string, key: string, token: string) => open(`${base}/visitor`, { auth: { key, token } });

/** A staff dashboard socket: access cookie + dashboard origin, joined to one workspace. */
export const staffSocket = async (base: string, cookie: string, workspaceId: string, origin = ORIGIN): Promise<Socket> => {
  // forceNew (in open): otherwise socket.io-client reuses another socket's connection and drops these headers.
  const socket = await open(`${base}/staff`, { extraHeaders: { cookie, origin } });
  const res = (await socket.emitWithAck('join', { workspaceId })) as { ok: boolean };
  if (!res.ok) {
    socket.disconnect();
    throw new Error('join refused');
  }
  return socket;
};

/** Sends a visitor message and waits for the ack (which comes after any reply). */
export const say = (socket: Socket, text: string) => socket.timeout(10_000).emitWithAck('message', { text }) as Promise<{ ok: boolean; error?: string }>;

/** Collects events of one name until stopped. */
export const collect = <T = ChatMessage>(socket: Socket, event: string) => {
  const items: T[] = [];
  socket.on(event, (x: T) => items.push(x));
  return items;
};

export const until = async (fn: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};
