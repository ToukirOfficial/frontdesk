import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeEmbedder } from '../src/ai/embeddings.js';
import { crawl } from '../src/knowledge/crawler.js';
import { KnowledgeProcessor } from '../src/knowledge/knowledge.processor.js';
import { VectorStore } from '../src/knowledge/vector-store.js';
import { isBlockedAddress, safeFetch, UrlRejectedError } from '../src/net/safe-fetch.js';
import type { KnowledgeJob } from '../src/queues.js';
import { as, registerOwner, reset, startApp, type TestApp } from './helpers.js';

describe('blocked addresses', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // AWS, GCP and Azure metadata
    '100.64.0.1',
    '100.100.100.200', // Alibaba Cloud metadata
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd00:ec2::254', // AWS metadata over IPv6
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    'not-an-ip',
  ])('%s is blocked', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.215.14', '2606:4700:4700::1111', '2a00:1450:4009:81f::200e'])('%s is allowed', (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe('safeFetch', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/secret' }).end();
      } else if (req.url === '/offsite') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end();
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('x'.repeat(3 * 1024 * 1024));
      } else if (req.url === '/slow') {
        setTimeout(() => res.end('late'), 2000);
      } else if (req.url === '/secret') {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<p>secret</p>');
      } else if (req.url === '/') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(
          '<html><head><title>Home</title></head><body><main><p>Welcome to the clinic.</p>' +
            '<a href="/prices">Prices</a> <a href="https://elsewhere.example/">Other site</a> <a href="/offsite">Moved</a>' +
            '</main><script>var x = "hidden";</script></body></html>',
        );
      } else if (req.url === '/prices') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><title>Prices</title><body><p>Massage costs £50.</p><nav>Menu</nav></body></html>');
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('refuses loopback, private and metadata addresses (literal and via DNS)', async () => {
    for (const url of [
      `${base}/secret`,
      'http://localhost/',
      'http://[::1]/',
      'http://0x7f000001/', // 127.0.0.1 written in hex
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:127.0.0.1]/',
      'http://10.0.0.1/',
    ]) {
      await expect(safeFetch(url, { allowHttp: true }), url).rejects.toBeInstanceOf(UrlRejectedError);
    }
  });

  it('refuses plain http unless allowed, other schemes, and credentials in the URL', async () => {
    await expect(safeFetch('http://example.com/')).rejects.toThrow(/https/);
    await expect(safeFetch('ftp://example.com/', { allowHttp: true })).rejects.toBeInstanceOf(UrlRejectedError);
    await expect(safeFetch('file:///etc/passwd', { allowHttp: true })).rejects.toBeInstanceOf(UrlRejectedError);
    await expect(safeFetch('https://user:pass@example.com/')).rejects.toThrow(/username or password/);
  });

  it('never follows redirects itself', async () => {
    const res = await safeFetch(`${base}/redirect`, { allowHttp: true, allowPrivate: true });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/secret');
    expect(res.body.toString()).toBe('');
  });

  it('enforces a size limit and a timeout', async () => {
    await expect(safeFetch(`${base}/big`, { allowHttp: true, allowPrivate: true })).rejects.toThrow(/too large/);
    await expect(safeFetch(`${base}/slow`, { allowHttp: true, allowPrivate: true, timeoutMs: 300 })).rejects.toThrow(/too long/);
  });

  it('the crawler stays on the same site and drops scripts and navigation', async () => {
    const pages = await crawl(`${base}/`, 10, { allowHttp: true, allowPrivate: true });
    expect(pages.map((p) => new URL(p.url).pathname).sort()).toEqual(['/', '/prices']);
    const home = pages.find((p) => p.url.endsWith('/'))!;
    expect(home.text).toContain('Welcome to the clinic.');
    expect(home.text).not.toContain('hidden');
    const prices = pages.find((p) => p.url.endsWith('/prices'))!;
    expect(prices.text).toContain('£50');
    expect(prices.text).not.toContain('Menu');
  });

  it('the crawler respects the page limit', async () => {
    const pages = await crawl(`${base}/`, 1, { allowHttp: true, allowPrivate: true });
    expect(pages).toHaveLength(1);
  });
});

describe('website import through the API and worker', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());
  beforeEach(() => reset(t));

  it('rejects non-web addresses up front', async () => {
    const owner = await registerOwner(t);
    for (const url of ['javascript:alert(1)', 'ftp://example.com/', 'file:///etc/passwd']) {
      await as(t, owner).post(`/api/workspaces/${owner.workspaceId}/knowledge/import-url`, { url }).expect(400);
    }
  });

  it('marks an import of a private address as failed, without fetching it', async () => {
    const owner = await registerOwner(t);
    const res = await as(t, owner)
      .post(`/api/workspaces/${owner.workspaceId}/knowledge/import-url`, { url: 'http://169.254.169.254/latest/meta-data/' })
      .expect(201);
    const processor = new KnowledgeProcessor(t.prisma, new VectorStore(t.prisma), new FakeEmbedder(), t.config);
    await processor.process({
      data: { workspaceId: owner.workspaceId, sourceId: res.body.id },
      attemptsMade: 0,
      opts: { attempts: 2 },
    } as Job<KnowledgeJob>);
    const row = await as(t, owner).get(`/api/workspaces/${owner.workspaceId}/knowledge/${res.body.id}`).expect(200);
    expect(row.body.status).toBe('failed');
    expect(row.body.error).toMatch(/private or internal/);
    expect(row.body.chunkCount).toBe(0);
  });
});
