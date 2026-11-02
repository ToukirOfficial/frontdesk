import OpenAI from 'openai';
import type { AppConfig } from '../config.js';
import { type ChatProvider, type ChatRequest, type ChatResult, ChatUnavailableError } from './chat-provider.js';

/** OpenAI chat completions, streamed. */
export class OpenAIProvider implements ChatProvider {
  private readonly client: OpenAI | null;

  constructor(private readonly config: AppConfig) {
    this.client = config.OPENAI_API_KEY ? new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: 1 }) : null;
  }

  async stream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult> {
    if (!this.client) throw new ChatUnavailableError('OPENAI_API_KEY is not set');
    const stream = await this.client.chat.completions.create(
      {
        model: this.config.OPENAI_CHAT_MODEL,
        max_completion_tokens: req.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'system', content: `${req.system}\n\n${req.reference}` }, ...req.messages],
        tools: req.tools.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        })),
      },
      { signal: req.signal },
    );

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let refused = false;
    const calls = new Map<number, { name: string; args: string }>();
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (delta?.content) {
        text += delta.content;
        onText(delta.content);
      }
      if (delta?.refusal) refused = true;
      for (const tc of delta?.tool_calls ?? []) {
        const current = calls.get(tc.index) ?? { name: '', args: '' };
        if (tc.function?.name) current.name = tc.function.name;
        if (tc.function?.arguments) current.args += tc.function.arguments;
        calls.set(tc.index, current);
      }
      if (choice?.finish_reason === 'content_filter') refused = true;
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }
    const toolCalls = [...calls.values()].flatMap((c) => {
      try {
        return [{ name: c.name, input: JSON.parse(c.args || '{}') as unknown }];
      } catch {
        return []; // a malformed call is ignored, never acted on
      }
    });
    return { text, toolCalls, inputTokens, outputTokens, refused };
  }
}
