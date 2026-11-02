import { Inject, Injectable, Logger } from '@nestjs/common';
import { DAYS, type Day, openingHoursSchema, type Preset, type SourceRef } from '@frontdesk/shared';
import { z } from 'zod';
import { type ChatProvider, CHAT_PROVIDER, type ChatTurn } from '../ai/chat-provider.js';
import { EMBEDDER, type Embedder } from '../ai/embeddings.js';
import { ASSISTANT_TOOLS, buildInstructions, buildReference, type PromptBusiness } from '../ai/prompts.js';
import { assistantContextKey } from '../business/business.service.js';
import { VectorStore } from '../knowledge/vector-store.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const K = 5;
const HISTORY = 12;
const MAX_TOKENS = 800;
const DAY_NAME: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export const FALLBACK_UNANSWERED =
  'I’m sorry, I don’t have that information. I can take a message for the team, or pass you to a member of staff.';
export const FALLBACK_ERROR =
  'Sorry, I can’t answer right now. You can leave a message for the team and they’ll get back to you.';

interface AssistantContext {
  business: PromptBusiness;
  preset: Preset;
  rules: string;
}

export interface ReplyResult {
  text: string;
  sources: SourceRef[];
  unanswered: boolean;
  inputTokens: number;
  outputTokens: number;
  failed: boolean;
}

const citeInput = z.object({ sources: z.array(z.number().int()) });
const unansweredInput = z.object({ question: z.string().min(1).max(2000) });

/**
 * Builds the grounded prompt for one visitor question and streams the model's reply. The returned text is final
 * (it may replace what was streamed, e.g. after a refusal); the widget shows it when the reply ends.
 */
@Injectable()
export class AssistantService {
  private readonly log = new Logger('Assistant');

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(VectorStore) private readonly vectors: VectorStore,
    @Inject(EMBEDDER) private readonly embedder: Embedder,
    @Inject(CHAT_PROVIDER) private readonly provider: ChatProvider,
  ) {}

  async reply(workspaceId: string, conversationId: string, question: string, onText: (t: string) => void): Promise<ReplyResult> {
    try {
      const [ctx, history, hits] = await Promise.all([
        this.context(workspaceId),
        this.history(workspaceId, conversationId),
        this.embedder.embed([question]).then(([v]) => this.vectors.search(workspaceId, v!, K)),
      ]);
      const extracts = hits.map((h, i) => ({ n: i + 1, title: h.sourceTitle, content: h.content }));

      const result = await this.provider.stream(
        {
          system: buildInstructions({ businessName: ctx.business.name, preset: ctx.preset, rules: ctx.rules }),
          reference: buildReference(ctx.business, extracts),
          messages: history,
          tools: ASSISTANT_TOOLS,
          maxTokens: MAX_TOKENS,
        },
        onText,
      );

      // Structured signals only: never inferred from the answer's wording.
      let unanswered = false;
      const cited = new Set<number>();
      for (const call of result.toolCalls) {
        if (call.name === 'report_unanswered' && unansweredInput.safeParse(call.input).success) unanswered = true;
        if (call.name === 'cite_sources') {
          const parsed = citeInput.safeParse(call.input);
          if (parsed.success) parsed.data.sources.forEach((n) => cited.add(n));
        }
      }
      if (unanswered) {
        await this.prisma.unansweredQuestion.create({ data: { workspaceId, conversationId, question: question.slice(0, 2000) } });
      }

      let text = result.text.trim();
      if (result.refused) text = FALLBACK_ERROR;
      else if (!text) text = unanswered ? FALLBACK_UNANSWERED : FALLBACK_ERROR;

      const sources: SourceRef[] = [];
      const seen = new Set<string>();
      for (const n of [...cited].sort((a, b) => a - b)) {
        const hit = hits[n - 1];
        if (!hit) continue; // the model can only cite what it was given
        const url = hit.pageUrl ?? hit.sourceUrl;
        const key = `${hit.sourceId}|${url ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sources.push({ title: hit.sourceTitle, url });
      }
      await this.recordUsage(workspaceId, result.inputTokens, result.outputTokens);
      return {
        text,
        sources: unanswered || result.refused ? [] : sources,
        unanswered,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        failed: false,
      };
    } catch (err) {
      // No message content in logs: only the error's type.
      this.log.error(`Reply failed in workspace ${workspaceId}: ${(err as Error).name}`);
      return { text: FALLBACK_ERROR, sources: [], unanswered: false, inputTokens: 0, outputTokens: 0, failed: true };
    }
  }

  private async context(workspaceId: string): Promise<AssistantContext> {
    const cached = await this.redis.getJson<AssistantContext>(assistantContextKey(workspaceId));
    if (cached) return cached;
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: { business: true, assistant: true },
    });
    const b = ws.business;
    const hours = openingHoursSchema.safeParse(b?.openingHours);
    const hoursText = hours.success
      ? [
          ...DAYS.map((d) => {
            const h = hours.data[d];
            return `${DAY_NAME[d]}: ${h.closed ? 'closed' : `${h.open}–${h.close}`}`;
          }),
          ...(hours.data.notes ? [`Notes: ${hours.data.notes}`] : []),
        ].join('\n')
      : 'not given';
    const ctx: AssistantContext = {
      business: {
        name: b?.name || ws.name,
        address: b?.address ?? '',
        email: b?.email ?? '',
        phone: b?.phone ?? '',
        bookingUrl: b?.bookingUrl ?? '',
        hours: hoursText,
      },
      preset: ws.assistant?.preset ?? 'general',
      rules: ws.assistant?.rules ?? '',
    };
    await this.redis.setJson(assistantContextKey(workspaceId), ctx, 300);
    return ctx;
  }

  /** The last few turns. Staff replies count as the assistant's side; system notes are left out. */
  private async history(workspaceId: string, conversationId: string): Promise<ChatTurn[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, workspaceId, role: { in: ['visitor', 'assistant', 'staff'] } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY,
    });
    const turns = rows.reverse().map<ChatTurn>((m) => ({
      role: m.role === 'visitor' ? 'user' : 'assistant',
      content: m.role === 'staff' ? `(A member of staff, ${m.authorName ?? 'staff'}, wrote:) ${m.content}` : m.content,
    }));
    while (turns[0]?.role === 'assistant') turns.shift(); // the conversation must start with the visitor
    return turns;
  }

  private async recordUsage(workspaceId: string, input: number, output: number): Promise<void> {
    if (!input && !output) return;
    const month = new Date().toISOString().slice(0, 7);
    await this.prisma.usageMonth.upsert({
      where: { workspaceId_month: { workspaceId, month } },
      create: { workspaceId, month, inputTokens: input, outputTokens: output },
      update: { inputTokens: { increment: input }, outputTokens: { increment: output } },
    });
  }
}
