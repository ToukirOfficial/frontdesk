import OpenAI from 'openai';
import type { ChatProvider, ChatRequest, ChatResult, ProviderSpec } from './chat-provider.js';

/** Google's OpenAI-compatible endpoint, so Gemini needs no extra library. */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * OpenAI, Gemini and any OpenAI-compatible endpoint (Ollama, vLLM, LM Studio, OpenRouter…), streamed through the
 * chat completions API.
 */
export class OpenAIFamilyProvider implements ChatProvider {
  private readonly client: OpenAI;

  constructor(private readonly spec: ProviderSpec) {
    const baseURL = spec.provider === 'gemini' ? GEMINI_BASE_URL : spec.provider === 'openai-compatible' ? spec.baseUrl : undefined;
    this.client = new OpenAI({
      // Ollama and some self-hosted servers need no key, but the client insists on one.
      apiKey: spec.apiKey || 'not-needed',
      baseURL,
      maxRetries: 1,
      timeout: 90_000,
      ...(spec.fetch ? { fetch: spec.fetch } : {}),
    });
  }

  /** OpenAI's newer models want max_completion_tokens; Gemini and most compatible servers want max_tokens. */
  private limit(n: number) {
    return this.spec.provider === 'openai' ? { max_completion_tokens: n } : { max_tokens: n };
  }

  async stream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult> {
    try {
      return await this.run(req, onText, true);
    } catch (err) {
      // Many local models can't use tools. Answer without them rather than not at all (no citations then).
      const status = (err as { status?: unknown }).status;
      if (this.spec.provider === 'openai-compatible' && status === 400 && /tool/i.test(String((err as Error).message))) {
        return this.run(req, onText, false);
      }
      throw err;
    }
  }

  private async run(req: ChatRequest, onText: (delta: string) => void, withTools: boolean): Promise<ChatResult> {
    const system = `${req.system}\n\n${req.reference}`;
    const stream = await this.client.chat.completions.create(
      {
        model: this.spec.model,
        ...this.limit(req.maxTokens),
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: 'system', content: system }, ...req.messages],
        ...(withTools && req.tools.length
          ? {
              tools: req.tools.map((t) => ({
                type: 'function' as const,
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
            }
          : {}),
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
    // Some compatible servers don't report usage. Estimate, so the monthly cap still counts something.
    if (!inputTokens && !outputTokens) {
      inputTokens = estimateTokens(system + req.messages.map((m) => m.content).join(''));
      outputTokens = estimateTokens(text);
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

  async ping(): Promise<void> {
    await this.client.chat.completions.create({
      model: this.spec.model,
      ...this.limit(16),
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    });
  }
}
