import Anthropic from '@anthropic-ai/sdk';
import type { ChatProvider, ChatRequest, ChatResult, ProviderSpec } from './chat-provider.js';

/** Claude through the official SDK, with whichever key and model the spec carries. */
export class AnthropicProvider implements ChatProvider {
  private readonly client: Anthropic;

  constructor(private readonly spec: ProviderSpec) {
    this.client = new Anthropic({ apiKey: spec.apiKey, maxRetries: 1, timeout: 90_000 });
  }

  async stream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult> {
    const stream = this.client.messages.stream(
      {
        model: this.spec.model,
        max_tokens: req.maxTokens,
        ...(this.spec.anthropicEffort ? { output_config: { effort: this.spec.anthropicEffort } } : {}),
        // The instructions never change between visitors of a workspace, so cache them.
        system: [
          { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: req.reference },
        ],
        messages: req.messages,
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        })),
        tool_choice: { type: 'auto' },
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

  async ping(): Promise<void> {
    await this.client.messages.create({ model: this.spec.model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with OK.' }] });
  }
}
