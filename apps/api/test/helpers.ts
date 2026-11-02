import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import request from 'supertest';
import { createApp } from '../src/bootstrap.js';
import { type AppConfig, loadConfig } from '../src/config.js';
import type { EmailJob } from '../src/mail/mail.queue.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { EMAIL_QUEUE } from '../src/queues.js';
import { RedisService, redisOptions } from '../src/redis/redis.service.js';

export const ORIGIN = 'http://localhost:8025';
export const PASSWORD = 'correct-horse-battery';

export interface TestApp {
  app: INestApplication;
  config: AppConfig;
  prisma: PrismaService;
  redis: RedisService;
  emails: Queue<EmailJob>;
  http: ReturnType<typeof request>;
  close: () => Promise<void>;
}

/** Starts the real app (real PostgreSQL and Redis). `env` overrides single settings for one test file. */
export const startApp = async (env: NodeJS.ProcessEnv = {}): Promise<TestApp> => {
  const config = loadConfig({ ...process.env, ...env });
  const app = await createApp(config);
  await app.init();
  const emails = new Queue<EmailJob>(EMAIL_QUEUE, {
    connection: redisOptions(config.REDIS_URL),
    prefix: `${config.REDIS_PREFIX}:bull`,
  });
  return {
    app,
    config,
    prisma: app.get(PrismaService),
    redis: app.get(RedisService),
    emails,
    http: request(app.getHttpServer()),
    close: async () => {
      await emails.close();
      await app.close();
    },
  };
};

/** Empties every table and every test Redis key (rate limits, queued emails). */
export const reset = async (t: TestApp): Promise<void> => {
  const tables = await t.prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await t.prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((x) => `"${x.tablename}"`).join(', ')} CASCADE`);
  }
  // The client adds the prefix to commands but not to SCAN patterns or results.
  const prefix = `${t.config.REDIS_PREFIX}:`;
  let cursor = '0';
  do {
    const [next, keys] = await t.redis.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    cursor = next;
    if (keys.length) await t.redis.client.del(...keys.map((k) => k.slice(prefix.length)));
  } while (cursor !== '0');
};

/** Cookie header from a response's Set-Cookie (supertest won't send Secure cookies over plain http). */
export const cookiesOf = (res: { headers: Record<string, unknown> }): string => {
  const set = (res.headers['set-cookie'] ?? []) as string[];
  return set
    .map((c) => c.split(';')[0] ?? '')
    .filter((c) => c && !c.endsWith('='))
    .join('; ');
};

export const cookieValue = (cookie: string, name: string): string | undefined =>
  cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

let seq = 0;
/** A different client IP per call (the API trusts X-Forwarded-For from loopback). */
export const nextIp = () => `10.0.${Math.floor(++seq / 250) % 250}.${seq % 250}`;
export const uniqueEmail = (tag = 'user') => `${tag}-${Date.now()}-${++seq}@example.test`;

/** The newest queued email to an address (no worker runs in tests, so jobs stay in the queue). */
export const lastEmailTo = async (t: TestApp, to: string): Promise<EmailJob> => {
  const jobs = await t.emails.getJobs(['waiting', 'prioritized', 'delayed', 'active', 'completed']);
  const mine = jobs.filter((j) => j?.data.to === to).sort((a, b) => b.timestamp - a.timestamp);
  const job = mine[0];
  if (!job) throw new Error(`No email queued for ${to}`);
  return job.data;
};

export const codeFrom = (mail: EmailJob): string => {
  const m = /\b(\d{6})\b/.exec(mail.text);
  if (!m?.[1]) throw new Error('No code in email');
  return m[1];
};

export const tokenFrom = (mail: EmailJob, path: string): string => {
  const m = new RegExp(`${path}[^A-Za-z0-9_-]?([A-Za-z0-9_-]{20,})`).exec(mail.text);
  if (!m?.[1]) throw new Error(`No ${path} token in email`);
  return m[1];
};

export interface Session {
  cookie: string;
  userId: string;
  email: string;
}

/** Logs in with email + password + emailed code. */
export const login = async (t: TestApp, email: string, password = PASSWORD): Promise<Session> => {
  const ip = nextIp();
  const step1 = await t.http
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ email, password })
    .expect(200);
  const code = codeFrom(await lastEmailTo(t, email));
  const step2 = await t.http
    .post('/api/auth/verify-code')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ challengeId: step1.body.challengeId, code })
    .expect(200);
  return { cookie: cookiesOf(step2), userId: step2.body.id, email };
};

/** Registers a user with their own workspace, completes the code step, returns the session and workspace id. */
export const registerOwner = async (t: TestApp, workspaceName = 'Test Clinic'): Promise<Session & { workspaceId: string }> => {
  const email = uniqueEmail('owner');
  const ip = nextIp();
  const reg = await t.http
    .post('/api/auth/register')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ workspaceName, name: 'Owner Person', email, password: PASSWORD })
    .expect(201);
  const code = codeFrom(await lastEmailTo(t, email));
  const res = await t.http
    .post('/api/auth/verify-code')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', ip)
    .send({ challengeId: reg.body.challengeId, code })
    .expect(200);
  const cookie = cookiesOf(res);
  const list = await t.http.get('/api/workspaces').set('Cookie', cookie).expect(200);
  return { cookie, userId: res.body.id, email, workspaceId: list.body.items[0].id };
};

/** Invites a new person with a role and has them accept; returns their session. */
export const addMember = async (
  t: TestApp,
  owner: Session & { workspaceId: string },
  role: 'admin' | 'staff',
): Promise<Session> => {
  const email = uniqueEmail(role);
  await as(t, owner).post(`/api/workspaces/${owner.workspaceId}/invites`, { email, role }).expect(201);
  const token = tokenFrom(await lastEmailTo(t, email), '/invite/');
  const res = await t.http
    .post('/api/invites/accept')
    .set('Origin', ORIGIN)
    .set('X-Forwarded-For', nextIp())
    .send({ token, name: `${role} person`, password: PASSWORD })
    .expect(200);
  const user = await t.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookie: cookiesOf(res), userId: user.id, email };
};

/** Shorthand for an authenticated dashboard request. */
export const as = (t: TestApp, s: { cookie: string }) => ({
  get: (url: string) => t.http.get(url).set('Cookie', s.cookie),
  post: (url: string, body: object = {}) => t.http.post(url).set('Origin', ORIGIN).set('Cookie', s.cookie).send(body),
  patch: (url: string, body: object = {}) =>
    t.http.patch(url).set('Origin', ORIGIN).set('Cookie', s.cookie).send(body),
  put: (url: string, body: object = {}) => t.http.put(url).set('Origin', ORIGIN).set('Cookie', s.cookie).send(body),
  delete: (url: string) => t.http.delete(url).set('Origin', ORIGIN).set('Cookie', s.cookie),
});

/** A tiny valid one-page PDF containing `text` (Helvetica), with a correct xref table. */
export const makePdf = (text: string): Buffer => {
  const stream = `BT /F1 18 Tf 72 700 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};
