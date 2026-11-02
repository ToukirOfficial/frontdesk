import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from '../common/ids.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

export interface NewChunk {
  content: string;
  pageUrl: string | null;
  embedding: number[];
}

export interface ChunkHit {
  id: string;
  sourceId: string;
  content: string;
  pageUrl: string | null;
  sourceTitle: string;
  sourceType: string;
  sourceUrl: string | null;
  distance: number;
}

const toVector = (v: number[]): string => `[${v.map((x) => (Number.isFinite(x) ? x : 0)).join(',')}]`;

/**
 * The only code that reads or writes embeddings. Every query takes a workspaceId and filters on it, so retrieval
 * can never return another workspace's knowledge.
 */
@Injectable()
export class VectorStore {
  private iterative?: Promise<boolean>;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Replaces all chunks of one source, atomically. */
  async replace(tx: Tx, workspaceId: string, sourceId: string, chunks: NewChunk[]): Promise<void> {
    await tx.knowledgeChunk.deleteMany({ where: { workspaceId, sourceId } });
    for (const [position, c] of chunks.entries()) {
      await tx.$executeRaw`
        INSERT INTO knowledge_chunks (id, workspace_id, source_id, position, content, page_url, embedding, updated_at)
        VALUES (${uuidv7()}::uuid, ${workspaceId}::uuid, ${sourceId}::uuid, ${position}, ${c.content}, ${c.pageUrl},
                ${toVector(c.embedding)}::vector, now())`;
    }
  }

  /**
   * The k nearest chunks in ONE workspace (cosine distance). With pgvector 0.8+, `hnsw.iterative_scan` keeps
   * scanning the HNSW index until k rows pass the workspace filter; on older pgvector the index is skipped and the
   * search is exact. Either way the filter never shrinks the result below k. See docs/decisions/0001.
   */
  async search(workspaceId: string, embedding: number[], k: number): Promise<ChunkHit[]> {
    const iterative = await this.supportsIterativeScan();
    const vector = toVector(embedding);
    const rows = await this.prisma.$transaction(async (tx) => {
      if (iterative) {
        await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = relaxed_order`);
        await tx.$executeRawUnsafe(`SET LOCAL hnsw.ef_search = 100`);
      } else {
        await tx.$executeRawUnsafe(`SET LOCAL enable_indexscan = off`);
      }
      return tx.$queryRaw<
        {
          id: string;
          source_id: string;
          content: string;
          page_url: string | null;
          title: string;
          type: string;
          url: string | null;
          distance: number;
        }[]
      >`
        SELECT c.id, c.source_id, c.content, c.page_url, s.title, s.type::text AS type, s.url,
               (c.embedding <=> ${vector}::vector)::float8 AS distance
        FROM knowledge_chunks c
        JOIN knowledge_sources s ON s.id = c.source_id AND s.workspace_id = c.workspace_id
        WHERE c.workspace_id = ${workspaceId}::uuid
        ORDER BY c.embedding <=> ${vector}::vector
        LIMIT ${k}`;
    });
    // relaxed_order may return rows slightly out of order: sort exactly here.
    return rows
      .map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        content: r.content,
        pageUrl: r.page_url,
        sourceTitle: r.title,
        sourceType: r.type,
        sourceUrl: r.url,
        distance: Number(r.distance),
      }))
      .sort((a, b) => a.distance - b.distance);
  }

  private supportsIterativeScan(): Promise<boolean> {
    this.iterative ??= this.prisma.$queryRaw<{ extversion: string }[]>`
      SELECT extversion FROM pg_extension WHERE extname = 'vector'`.then((rows) => {
      const [major = 0, minor = 0] = (rows[0]?.extversion ?? '0.0').split('.').map(Number);
      return major > 0 || minor >= 8;
    });
    return this.iterative;
  }
}
