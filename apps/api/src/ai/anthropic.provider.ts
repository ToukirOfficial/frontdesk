import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config.js';
import { type ChatProvider, type ChatRequest, type ChatResult, ChatUnavailableError } from './chat-provider.js';

/** Claude through the official SDK. Model, effort and fallbacks come from env. */
export class AnthropicProvider implements ChatProvider {
  private readonly client: Anthropic | null;

  constructor(private readonly config: AppConfig) {
    this.client = config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 1 }) : null;
  }

  async stream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult> {
    if (!this.client) throw new ChatUnavailableError('ANTHROPIC_API_KEY is not set');
    const fallbacks = this.config.ANTHROPIC_FALLBACKS === 'default';
    const stream = this.client.beta.messages.stream(
      {
        model: this.config.ANTHROPIC_MODEL,
        max_tokens: req.maxTokens,
        output_config: { effort: this.config.ANTHROPIC_EFFORT },
        // The instructions never change between visitors of a workspace, so cache them.
        system: [
          { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: req.reference },
        ],
        messages: req.messages,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
          strict: true,
        })),
        tool_choice: { type: 'auto' },
        ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal: req.signal },
    );

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') onText(event.delta.text);
    }
    const message = await stream.finalMessage();
    const toolCalls = message.content.flatMap((b) => (b.type === 'tool_use' ? [{ name: b.name, input: b.input }] : []));
    return {
      text: message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''),
      toolCalls,
      inputTokens:
        message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0),
      outputTokens: message.usage.output_tokens,
      refused: message.stop_reason === 'refusal',
    };
  }
}
