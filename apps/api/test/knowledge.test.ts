import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeEmbedder } from '../src/ai/embeddings.js';
import { KnowledgeProcessor } from '../src/knowledge/knowledge.processor.js';
import { VectorStore } from '../src/knowledge/vector-store.js';
import { KNOWLEDGE_QUEUE, type KnowledgeJob } from '../src/queues.js';
import { redisOptions } from '../src/redis/redis.service.js';
import { addMember, as, makePdf, ORIGIN, registerOwner, reset, startApp, type TestApp } from './helpers.js';

let t: TestApp;
let processor: KnowledgeProcessor;
let vectors: VectorStore;
let queue: Queue<KnowledgeJob>;

beforeAll(async () => {
  t = await startApp();
  vectors = new VectorStore(t.prisma);
  processor = new KnowledgeProcessor(t.prisma, vectors, new FakeEmbedder(), t.config);
  queue = new Queue(KNOWLEDGE_QUEUE, { connection: redisOptions(t.config.REDIS_URL), prefix: `${t.config.REDIS_PREFIX}:bull` });
});
afterAll(async () => {
  await queue.close();
  await t.close();
});
beforeEach(() => reset(t));

/** Runs the worker's job for a source, as the worker would. */
const processSource = (workspaceId: string, sourceId: string) =>
  processor.process({ data: { workspaceId, sourceId }, attemptsMade: 0, opts: { attempts: 2 } } as Job<KnowledgeJob>);

const K = (workspaceId: string) => `/api/workspaces/${workspaceId}/knowledge`;

describe('knowledge permissions and isolation', () => {
  it('staff cannot manage knowledge; owners and admins can', async () => {
    const owner = await registerOwner(t);
    const admin = await addMember(t, owner, 'admin');
    const staff = await addMember(t, owner, 'staff');
    const faq = { type: 'faq', question: 'Do you open on Sundays?', answer: 'No, we are closed on Sundays.' };

    await as(t, staff).get(K(owner.workspaceId)).expect(403);
    await as(t, staff).post(K(owner.workspaceId), faq).expect(403);
    await as(t, admin).post(K(owner.workspaceId), faq).expect(201);
    const list = await as(t, owner).get(K(owner.workspaceId)).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ type: 'faq', status: 'processing', chunkCount: 0 });
  });

  it('another workspace’s source is not found for every action', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    const src = await as(t, b)
      .post(K(b.workspaceId), { type: 'text', title: 'Prices', content: 'A massage costs £50.' })
      .expect(201);
    const id = src.body.id as string;

    // Through A's own workspace URL with B's source id.
    await as(t, a).get(`${K(a.workspaceId)}/${id}`).expect(404);
    await as(t, a).patch(`${K(a.workspaceId)}/${id}`, { content: 'Hacked' }).expect(404);
    await as(t, a).post(`${K(a.workspaceId)}/${id}/reprocess`).expect(404);
    await as(t, a).delete(`${K(a.workspaceId)}/${id}`).expect(404);
    await as(t, a).get(`${K(a.workspaceId)}/${id}/file`).expect(404);
    // Through B's workspace URL.
    await as(t, a).get(K(b.workspaceId)).expect(404);
    await as(t, a).get(`${K(b.workspaceId)}/${id}`).expect(404);

    const still = await as(t, b).get(`${K(b.workspaceId)}/${id}`).expect(200);
    expect(still.body.content).toBe('A massage costs £50.');
  });

  it('queues processing for new knowledge', async () => {
    const owner = await registerOwner(t);
    const src = await as(t, owner).post(K(owner.workspaceId), { type: 'faq', question: 'Parking?', answer: 'Free parking behind the building.' }).expect(201);
    const jobs = await queue.getJobs(['waiting', 'prioritized', 'delayed']);
    expect(jobs.map((j) => j.data)).toContainEqual({ workspaceId: owner.workspaceId, sourceId: src.body.id });
  });
});

describe('processing', () => {
  it('embeds an FAQ and a text page, then marks them ready', async () => {
    const owner = await registerOwner(t);
    const faq = await as(t, owner).post(K(owner.workspaceId), { type: 'faq', question: 'Parking?', answer: 'Free parking behind the building.' }).expect(201);
    const long = Array.from({ length: 40 }, (_, i) => `Treatment ${i} is offered on weekdays and costs a fair price.`).join(' ');
    const text = await as(t, owner).post(K(owner.workspaceId), { type: 'text', title: 'Treatments', content: long }).expect(201);

    await processSource(owner.workspaceId, faq.body.id);
    await processSource(owner.workspaceId, text.body.id);

    const f = await as(t, owner).get(`${K(owner.workspaceId)}/${faq.body.id}`).expect(200);
    expect(f.body).toMatchObject({ status: 'ready', chunkCount: 1, error: null });
    const tx = await as(t, owner).get(`${K(owner.workspaceId)}/${text.body.id}`).expect(200);
    expect(tx.body.status).toBe('ready');
    expect(tx.body.chunkCount).toBeGreaterThan(1);
  });

  it('editing an FAQ re-queues it; files and websites cannot be edited', async () => {
    const owner = await registerOwner(t);
    const faq = await as(t, owner).post(K(owner.workspaceId), { type: 'faq', question: 'Parking?', answer: 'Yes.' }).expect(201);
    await processSource(owner.workspaceId, faq.body.id);
    const edited = await as(t, owner).patch(`${K(owner.workspaceId)}/${faq.body.id}`, { answer: 'Yes, free.' }).expect(200);
    expect(edited.body.status).toBe('processing');

    const pdf = await t.http
      .post(`${K(owner.workspaceId)}/upload`)
      .set('Origin', ORIGIN)
      .set('Cookie', owner.cookie)
      .attach('file', makePdf('Opening hours'), 'hours.pdf')
      .expect(201);
    const r = await as(t, owner).patch(`${K(owner.workspaceId)}/${pdf.body.id}`, { content: 'x' }).expect(400);
    expect(r.body.errorCode).toBe('NOT_EDITABLE');
  });

  it('deleting a source deletes its chunks', async () => {
    const owner = await registerOwner(t);
    const faq = await as(t, owner).post(K(owner.workspaceId), { type: 'faq', question: 'Parking?', answer: 'Yes.' }).expect(201);
    await processSource(owner.workspaceId, faq.body.id);
    expect(await t.prisma.knowledgeChunk.count({ where: { sourceId: faq.body.id } })).toBe(1);
    await as(t, owner).delete(`${K(owner.workspaceId)}/${faq.body.id}`).expect(200);
    expect(await t.prisma.knowledgeChunk.count({ where: { sourceId: faq.body.id } })).toBe(0);
  });
});

describe('uploads', () => {
  const upload = (s: { cookie: string }, workspaceId: string, data: Buffer, name: string) =>
    t.http.post(`${K(workspaceId)}/upload`).set('Origin', ORIGIN).set('Cookie', s.cookie).attach('file', data, name);

  it('checks the real file type, not the name', async () => {
    const owner = await registerOwner(t);
    const fake = await upload(owner, owner.workspaceId, Buffer.from('<script>alert(1)</script>'), 'prices.pdf').expect(400);
    expect(fake.body.errorCode).toBe('FILE_REJECTED');
    await upload(owner, owner.workspaceId, Buffer.from('\x89PNG\r\n\x1a\n0000000000000IHDR'), 'logo.pdf').expect(400);
  });

  it('stores a PDF under a random name, extracts its text and serves it only to its workspace', async () => {
    const owner = await registerOwner(t, 'Workspace A');
    const staff = await addMember(t, owner, 'staff');
    const other = await registerOwner(t, 'Workspace B');
    const res = await upload(owner, owner.workspaceId, makePdf('Sports massage costs 55 pounds'), '../../etc/passwd.pdf').expect(201);
    expect(res.body).toMatchObject({ type: 'file', fileName: 'passwd.pdf', status: 'processing' });

    const row = await t.prisma.knowledgeSource.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.storedName).toMatch(/^[0-9a-f-]{36}\.pdf$/);

    await processSource(owner.workspaceId, res.body.id);
    const ready = await as(t, owner).get(`${K(owner.workspaceId)}/${res.body.id}`).expect(200);
    expect(ready.body.status).toBe('ready');
    const chunk = await t.prisma.knowledgeChunk.findFirstOrThrow({ where: { sourceId: res.body.id } });
    expect(chunk.content).toContain('Sports massage costs 55 pounds');

    const dl = await as(t, owner).get(`${K(owner.workspaceId)}/${res.body.id}/file`).expect(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    await as(t, staff).get(`${K(owner.workspaceId)}/${res.body.id}/file`).expect(403);
    await as(t, other).get(`${K(other.workspaceId)}/${res.body.id}/file`).expect(404);
    await t.http.get(`${K(owner.workspaceId)}/${res.body.id}/file`).expect(401);
  });

  it('refuses anonymous uploads before reading the file', async () => {
    const owner = await registerOwner(t);
    await t.http
      .post(`${K(owner.workspaceId)}/upload`)
      .set('Origin', ORIGIN)
      .attach('file', makePdf('x'), 'x.pdf')
      .expect(401);
  });
});

describe('vector search', () => {
  /** Stores chunks straight into the vector store with fake embeddings. */
  const seed = async (workspaceId: string, texts: string[]) => {
    const source = await t.prisma.knowledgeSource.create({
      data: { workspaceId, type: 'text', title: 'Seed', content: '', status: 'ready' },
    });
    const embeddings = await new FakeEmbedder().embed(texts);
    await t.prisma.$transaction((tx) =>
      vectors.replace(
        tx,
        workspaceId,
        source.id,
        texts.map((content, i) => ({ content, pageUrl: null, embedding: embeddings[i]! })),
      ),
    );
  };

  it('never returns another workspace’s chunks, and still returns k results when others are closer', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    const c = await registerOwner(t, 'Workspace C');
    // B and C hold hundreds of chunks that match the question almost exactly...
    await seed(b.workspaceId, Array.from({ length: 300 }, (_, i) => `What are your opening hours on Saturday ${i}`));
    await seed(c.workspaceId, Array.from({ length: 300 }, (_, i) => `opening hours Saturday answer ${i}`));
    // ...while A's chunks are only loosely related.
    await seed(a.workspaceId, Array.from({ length: 12 }, (_, i) => `Our clinic note number ${i} about hours and parking`));

    const [query] = await new FakeEmbedder().embed(['What are your opening hours on Saturday?']);
    const hits = await vectors.search(a.workspaceId, query!, 5);
    expect(hits).toHaveLength(5);
    const ids = new Set(
      (await t.prisma.knowledgeChunk.findMany({ where: { workspaceId: a.workspaceId }, select: { id: true } })).map((x) => x.id),
    );
    for (const h of hits) expect(ids.has(h.id)).toBe(true);
    // Sorted nearest first.
    expect(hits.map((h) => h.distance)).toEqual([...hits.map((h) => h.distance)].sort((x, y) => x - y));

    const bHits = await vectors.search(b.workspaceId, query!, 5);
    expect(bHits).toHaveLength(5);
    expect(bHits.every((h) => h.content.startsWith('What are your opening hours'))).toBe(true);
  });

  it('returns nothing for a workspace with no knowledge', async () => {
    const a = await registerOwner(t, 'Workspace A');
    const b = await registerOwner(t, 'Workspace B');
    await seed(b.workspaceId, ['Prices start at £40']);
    const [query] = await new FakeEmbedder().embed(['prices']);
    expect(await vectors.search(a.workspaceId, query!, 5)).toEqual([]);
  });
});
