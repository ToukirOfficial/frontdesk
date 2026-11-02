import type { AiProvider } from '@frontdesk/shared';

/** One small interface over the chat models. Which provider, model and key: see ai-resolver.ts. */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

export interface ChatRequest {
  /** Instructions that are the same for every message in a workspace (cached where the provider supports it)... */
  system: string;
  /** ...then the reference data for this question. */
  reference: string;
  messages: ChatTurn[];
  tools: ToolDef[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ToolCall {
  name: string;
  input: unknown;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  /** The model declined (safety refusal) or was cut off; the caller shows a safe fallback. */
  refused: boolean;
}

export interface ChatProvider {
  /** Streams text through onText and resolves with the full result (tool calls arrive at the end). */
  stream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResult>;
  /** One tiny request ("Test key"). Throws if the provider refuses it. */
  ping(): Promise<void>;
}

/** Everything needed to talk to one provider. Built from .env (instance) or a workspace's or demo visitor's own key. */
export interface ProviderSpec {
  provider: AiProvider;
  model: string;
  /** Empty for keyless OpenAI-compatible endpoints (e.g. Ollama). */
  apiKey: string;
  /** openai-compatible only. */
  baseUrl?: string;
  /** Instance key only. */
  anthropicEffort?: 'low' | 'medium' | 'high';
  /** Set for addresses typed into the dashboard: connects only to vetted public addresses (SSRF guard). */
  fetch?: typeof fetch;
}

export type ProviderFailure = 'bad_key' | 'not_found' | 'bad_request' | 'rate_limited' | 'unreachable' | 'other';

/**
 * Reduces any provider error to a fixed category. Provider error messages can echo parts of a request (even a key),
 * so they are never logged or shown: only this category is.
 */
export const classifyProviderError = (err: unknown): ProviderFailure => {
  const e = err as { status?: unknown; name?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : undefined;
  if (status === 401 || status === 403) return 'bad_key';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status !== undefined && status >= 400 && status < 500) return 'bad_request';
  const name = typeof e?.name === 'string' ? e.name : '';
  if (/Connection|Timeout|UrlRejected|Abort/.test(name)) return 'unreachable';
  return 'other';
};

export const FAILURE_MESSAGES: Record<ProviderFailure, string> = {
  bad_key: 'The provider rejected this key. Check it was copied in full and is active.',
  not_found: 'The provider doesn’t know that model. Check the model name.',
  bad_request: 'The provider refused the request. Check the model name and that it supports chat.',
  rate_limited: 'The provider says this key is over its rate limit or out of credit.',
  unreachable: 'Couldn’t reach the provider. Check the address and try again.',
  other: 'The provider returned an error. Please try again.',
};
