import type { ChatProvider, ChatRequest, ChatResult } from './chat-provider.js';

/**
 * Tests only. Records every request (so tests can check what the model would have seen) and answers predictably:
 * a question containing "UNKNOWN" gets "I don't know" plus a report_unanswered call; anything else gets the first
 * knowledge snippet and a citation of source 1.
 */
export class FakeChatProvider implements ChatProvider {
  static readonly requests: ChatRequest[] = [];

  async stream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult> {
    FakeChatProvider.requests.push(req);
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
}
