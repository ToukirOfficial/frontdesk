import type { ChatProvider, ChatRequest, ChatResult, ProviderSpec } from './chat-provider.js';

export interface FakeRecord extends ChatRequest {
  /** Which key and model answered, so tests can check a workspace only ever uses its own key. */
  apiKey: string | null;
  model: string | null;
}

/** Shaped like an SDK error that echoes part of the request, to prove such messages never reach logs or users. */
const rejected = (key: string) => Object.assign(new Error(`401 invalid x-api-key: ${key}`), { status: 401, name: 'AuthenticationError' });

/**
 * Tests only: every provider becomes this one in NODE_ENV=test, so no test can ever call a real API. Records every
 * request and answers predictably: a question containing "UNKNOWN" gets "I don't know" plus a report_unanswered
 * call; anything else gets the first knowledge snippet and a citation of source 1. A key containing "bad" is
 * rejected like a real provider would.
 */
export class FakeChatProvider implements ChatProvider {
  static readonly requests: FakeRecord[] = [];
  static pings: (string | null)[] = [];

  constructor(private readonly spec?: ProviderSpec) {}

  async stream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult> {
    if (this.spec?.apiKey.includes('bad')) throw rejected(this.spec.apiKey);
    FakeChatProvider.requests.push({ ...req, apiKey: this.spec?.apiKey ?? null, model: this.spec?.model ?? null });
    const question = req.messages.at(-1)?.content ?? '';
    const unknown = question.includes('UNKNOWN');
    const snippet = /<untrusted_data source="knowledge" n="1"[^>]*>\n?([\s\S]{0,60})/.exec(req.reference)?.[1]?.trim();
    const text = unknown ? 'I’m sorry, I don’t have that information.' : `From our information: ${snippet ?? 'nothing found'}`;
    for (const word of text.split(/(?<= )/)) {
      onText(word);
      await new Promise((r) => setTimeout(r, 1));
    }
    return {
      text,
      toolCalls: unknown
        ? [{ name: 'report_unanswered', input: { question } }]
        : snippet
          ? [{ name: 'cite_sources', input: { sources: [1] } }]
          : [],
      inputTokens: Math.ceil((req.system.length + req.reference.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
      refused: false,
    };
  }

  ping(): Promise<void> {
    FakeChatProvider.pings.push(this.spec?.apiKey ?? null);
    if (this.spec?.apiKey.includes('bad')) return Promise.reject(rejected(this.spec.apiKey));
    return Promise.resolve();
  }
}
