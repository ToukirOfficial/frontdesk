import type { AppConfig } from '../config.js';
import { AnthropicProvider } from './anthropic.provider.js';
import type { ChatProvider } from './chat-provider.js';
import { FakeChatProvider } from './fake.provider.js';
import { OpenAIProvider } from './openai.provider.js';

export const createChatProvider = (config: AppConfig): ChatProvider => {
  switch (config.AI_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'fake':
      return new FakeChatProvider();
  }
};
