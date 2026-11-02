import { createHash } from 'node:crypto';
import type { AiConfig } from '../config.js';

/** Every embedding provider returns unit-length vectors of this size (the pgvector column is vector(384)). */
export const EMBEDDING_DIMS = 384;

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export const EMBEDDER = Symbol('EMBEDDER');

const normalise = (v: number[]): number[] => {
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / len);
};

/**
 * all-MiniLM-L6-v2 run on this machine's CPU (no API key, nothing leaves the server). The model is downloaded once
 * to MODEL_CACHE_DIR on first use and loaded lazily, so only the worker pays for it.
 */
class LocalEmbedder implements Embedder {
  private extractor?: Promise<(texts: string[], opts: object) => Promise<{ tolist(): number[][] }>>;

  constructor(private readonly config: AiConfig) {}

  private load() {
    this.extractor ??= (async () => {
      const t = await import('@huggingface/transformers');
      t.env.cacheDir = this.config.MODEL_CACHE_DIR;
      t.env.allowRemoteModels = true;
      const pipe = await t.pipeline('feature-extraction', this.config.LOCAL_EMBEDDING_MODEL, { dtype: 'q8' });
      return pipe as unknown as (texts: string[], opts: object) => Promise<{ tolist(): number[][] }>;
    })();
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const extractor = await this.load();
    const out = await extractor(texts, { pooling: 'mean', normalize: true });
    return out.tolist();
  }
}

/** OpenAI embeddings, shortened to 384 dimensions so they fit the same column. */
class OpenAIEmbedder implements Embedder {
  private client?: Promise<import('openai').default>;

  constructor(private readonly config: AiConfig) {}

  async embed(texts: string[]): Promise<number[][]> {
    this.client ??= import('openai').then((m) => new m.default({ apiKey: this.config.OPENAI_API_KEY }));
    const client = await this.client;
    const res = await client.embeddings.create({
      model: this.config.OPENAI_EMBEDDING_MODEL,
      input: texts,
      dimensions: EMBEDDING_DIMS,
    });
    return res.data.sort((a, b) => a.index - b.index).map((d) => normalise(d.embedding));
  }
}

/**
 * Tests only: a deterministic bag-of-words hash, so texts sharing words land close together. Never calls a real
 * model or API.
 */
export class FakeEmbedder implements Embedder {
  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(texts.map((t) => FakeEmbedder.vector(t)));
  }

  static vector(text: string): number[] {
    const v: number[] = Array.from({ length: EMBEDDING_DIMS }, () => 0);
    for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      const h = createHash('sha256').update(word).digest();
      v[h.readUInt16BE(0) % EMBEDDING_DIMS]! += 1;
      v[h.readUInt16BE(2) % EMBEDDING_DIMS]! += 0.5;
    }
    if (!v.some((x) => x !== 0)) v[0] = 1;
    return normalise(v);
  }
}

export const createEmbedder = (config: AiConfig): Embedder => {
  switch (config.EMBEDDING_PROVIDER) {
    case 'local':
      return new LocalEmbedder(config);
    case 'openai':
      return new OpenAIEmbedder(config);
    case 'fake':
      return new FakeEmbedder();
  }
};
