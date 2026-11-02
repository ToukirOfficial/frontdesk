import type { AiConfig } from '../config.js';
import { missingAiSettings } from '../config.js';
import { AnthropicProvider } from './anthropic.provider.js';
import type { ChatProvider, ProviderSpec } from './chat-provider.js';
import { FakeChatProvider } from './fake.provider.js';
import { OpenAIFamilyProvider } from './openai.provider.js';

/** Builds a provider from a spec. In tests every provider is the fake one, so no test can reach a real API. */
export const createProvider = (spec: ProviderSpec, nodeEnv: string): ChatProvider => {
  if (nodeEnv === 'test') return new FakeChatProvider(spec);
  return spec.provider === 'anthropic' ? new AnthropicProvider(spec) : new OpenAIFamilyProvider(spec);
};

/** The instance's own provider from .env, or null when none is set (or its settings are incomplete). */
export const instanceSpec = (c: AiConfig): ProviderSpec | null => {
  if (!c.AI_PROVIDER || missingAiSettings(c).length) return null;
  if (c.AI_PROVIDER === 'fake') return { provider: 'openai', model: 'fake', apiKey: '' };
  return {
    provider: c.AI_PROVIDER,
    model: c.AI_MODEL,
    apiKey: c.AI_API_KEY,
    baseUrl: c.AI_BASE_URL || undefined,
    anthropicEffort: c.ANTHROPIC_EFFORT || undefined,
  };
};
