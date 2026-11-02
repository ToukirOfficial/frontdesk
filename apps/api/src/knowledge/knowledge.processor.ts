import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { EMBEDDER, type Embedder } from '../ai/embeddings.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { UrlRejectedError } from '../net/safe-fetch.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KNOWLEDGE_QUEUE, type KnowledgeJob } from '../queues.js';
import { chunkText } from './chunking.js';
import { crawl } from './crawler.js';
import { ExtractError, extractText } from './extract.js';
import { readStoredFile } from './storage.js';
import { type NewChunk, VectorStore } from './vector-store.js';

const BATCH = 32;
const MAX_CHUNKS = 2000;

/** Turns a knowledge source into embedded chunks: extract text, split, embed, store. Runs in the worker only. */
@Processor(KNOWLEDGE_QUEUE, { concurrency: 2 })
export class KnowledgeProcessor extends WorkerHost {
  private readonly log = new Logger('Knowledge');

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(VectorStore) private readonly vectors: VectorStore,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async process(job: Job<KnowledgeJob>): Promise<void> {
    const { workspaceId, sourceId } = job.data;
    const source = await this.prisma.knowledgeSource.findFirst({ where: { id: sourceId, workspaceId } });
    if (!source) return; // deleted while queued

    try {
      const pieces = await this.pieces(source);
      if (!pieces.length) throw new ExtractError('No text was found in it.');
      if (pieces.length > MAX_CHUNKS) throw new ExtractError('It’s too long. Split it into smaller parts.');

      const chunks: NewChunk[] = [];
      for (let i = 0; i < pieces.length; i += BATCH) {
        const batch = pieces.slice(i, i + BATCH);
        const vectors = await this.embedder.embed(batch.map((p) => p.content));
        batch.forEach((p, j) => chunks.push({ ...p, embedding: vectors[j]! }));
      }

      await this.prisma.$transaction(
        async (tx) => {
          // Still there and still ours? (It may have been deleted while we worked.)
          const still = await tx.knowledgeSource.findFirst({ where: { id: sourceId, workspaceId }, select: { id: true } });
          if (!still) return;
          await this.vectors.replace(tx, workspaceId, sourceId, chunks);
          await tx.knowledgeSource.update({
            where: { id: sourceId },
            data: { status: 'ready', error: null, chunkCount: chunks.length },
          });
        },
        { timeout: 60_000 },
      );
      this.log.log(`Source ${sourceId} ready (${chunks.length} chunks)`);
    } catch (err) {
      const known = err instanceof ExtractError || err instanceof UrlRejectedError;
      // Only our own messages reach the dashboard; anything else is a generic failure (and logged without content).
      const message = known ? (err as Error).message : 'Processing failed. Try again later.';
      if (!known) this.log.error(`Source ${sourceId} failed: ${(err as Error).name}`);
      const lastAttempt = known || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (lastAttempt) {
        await this.prisma.knowledgeSource.updateMany({
          where: { id: sourceId, workspaceId },
          data: { status: 'failed', error: message },
        });
      }
      if (!known) throw err; // let BullMQ retry
    }
  }

  private async pieces(source: {
    type: string;
    title: string;
    question: string | null;
    content: string | null;
    storedName: string | null;
    mimeType: string | null;
    url: string | null;
    maxPages: number | null;
  }): Promise<{ content: string; pageUrl: string | null }[]> {
    switch (source.type) {
      case 'faq':
        return [{ content: `Question: ${source.question ?? ''}\nAnswer: ${source.content ?? ''}`, pageUrl: null }];
      case 'text':
        return chunkText(`${source.title}\n\n${source.content ?? ''}`).map((content) => ({ content, pageUrl: null }));
      case 'file': {
        if (!source.storedName || !source.mimeType) throw new ExtractError('The file is missing.');
        const text = await extractText(await readStoredFile(this.config, source.storedName), source.mimeType);
        return chunkText(text).map((content) => ({ content: `${source.title}\n\n${content}`, pageUrl: null }));
      }
      case 'url': {
        if (!source.url) throw new UrlRejectedError('The address is missing.');
        const pages = await crawl(source.url, source.maxPages ?? 10, {
          allowHttp: this.config.NODE_ENV !== 'production',
          allowPrivate: this.config.ALLOW_PRIVATE_URLS,
        });
        return pages.flatMap((p) => chunkText(p.text).map((content) => ({ content: `${p.title}\n\n${content}`, pageUrl: p.url })));
      }
      default:
        throw new ExtractError('Unknown knowledge type.');
    }
  }
}
