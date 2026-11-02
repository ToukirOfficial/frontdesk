import type { OpeningHours, Preset, SourceRef } from '@frontdesk/shared';
import { DEMO_BUSINESS, DEMO_FAQS, DEMO_PAGES, DEMO_RULES } from '../demo/clinic.js';
import { chunkText } from '../knowledge/chunking.js';
import type { ChatProvider, ChatResult } from './chat-provider.js';
import type { Embedder } from './embeddings.js';
import { ASSISTANT_TOOLS, buildInstructions, buildReference, formatHours } from './prompts.js';

/**
 * The assistant without a database, for the evaluation set and the demo's replay recorder: the same chunking,
 * the same top-5 nearest (in memory instead of pgvector), the same prompts and tools as the app.
 */
export interface OfflineScenario {
  business: { name: string; address: string; email: string; phone: string; bookingUrl: string; openingHours: OpeningHours };
  preset: Preset;
  rules: string;
  knowledge: { title: string; content: string }[];
}

export const demoScenario = (): OfflineScenario => ({
  business: DEMO_BUSINESS,
  preset: 'clinic',
  rules: DEMO_RULES,
  knowledge: [
    ...DEMO_FAQS.map((f) => ({ title: f.question, content: `Question: ${f.question}\nAnswer: ${f.answer}` })),
    ...DEMO_PAGES.map((p) => ({ title: p.title, content: p.content })),
  ],
});

const K = 5;
const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

export interface OfflineAnswer extends ChatResult {
  unanswered: boolean;
  sources: SourceRef[];
}

export class OfflineAssistant {
  private readonly cache = new Map<string, number[][]>();

  constructor(private readonly embedder: Embedder) {}

  async retrieve(scenario: OfflineScenario, question: string, extra: { title: string; content: string }[] = []) {
    const pieces = [...scenario.knowledge, ...extra].flatMap((d) =>
      d.content.startsWith('Question:')
        ? [{ title: d.title, content: d.content }]
        : chunkText(`${d.title}\n\n${d.content}`).map((c) => ({ title: d.title, content: c })),
    );
    const key = JSON.stringify(pieces);
    let vectors = this.cache.get(key);
    if (!vectors) {
      vectors = await this.embedder.embed(pieces.map((p) => p.content));
      this.cache.set(key, vectors);
    }
    const [q] = await this.embedder.embed([question]);
    return pieces
      .map((p, i) => ({ ...p, score: cosine(q!, vectors[i]!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, K)
      .map((p, i) => ({ n: i + 1, title: p.title, content: p.content }));
  }

  async ask(provider: ChatProvider, scenario: OfflineScenario, question: string, extra?: { title: string; content: string }[]): Promise<OfflineAnswer> {
    const extracts = await this.retrieve(scenario, question, extra);
    const s = scenario.business;
    const r = await provider.stream(
      {
        system: buildInstructions({ businessName: s.name, preset: scenario.preset, rules: scenario.rules }),
        reference: buildReference({ ...s, hours: formatHours(s.openingHours) }, extracts),
        messages: [{ role: 'user', content: question }],
        tools: ASSISTANT_TOOLS,
        maxTokens: 800,
      },
      () => undefined,
    );
    const unanswered = r.toolCalls.some((t) => t.name === 'report_unanswered');
    const cited = new Set<number>();
    for (const t of r.toolCalls) {
      const list = t.name === 'cite_sources' ? (t.input as { sources?: unknown }).sources : undefined;
      if (Array.isArray(list)) list.forEach((n) => typeof n === 'number' && cited.add(n));
    }
    const titles = [...new Set([...cited].sort((a, b) => a - b).flatMap((n) => (extracts[n - 1] ? [extracts[n - 1]!.title] : [])))];
    return { ...r, unanswered, sources: unanswered ? [] : titles.map((title) => ({ title, url: null })) };
  }
}
