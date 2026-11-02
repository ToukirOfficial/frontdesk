/** One small interface over the chat models, chosen by AI_PROVIDER. */

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
}

export const CHAT_PROVIDER = Symbol('CHAT_PROVIDER');

export class ChatUnavailableError extends Error {}
