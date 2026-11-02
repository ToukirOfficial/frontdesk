// Records the public demo's replay set from whichever provider is configured in .env (AI_PROVIDER, AI_MODEL,
// AI_API_KEY, AI_BASE_URL): pnpm --filter @frontdesk/api demo:record
// It asks the suggested questions in apps/api/demo/replay.json against the demo clinic, with the app's own prompts
// and retrieval, and writes the answers back. Commit the file; the demo then replays them at no cost.
import { writeFileSync } from 'node:fs';
import { createEmbedder } from '../ai/embeddings.js';
import { demoScenario, OfflineAssistant } from '../ai/offline.js';
import { PROMPT_VERSION } from '../ai/prompts.js';
import { createProvider, instanceSpec } from '../ai/providers.js';
import { loadAiConfig, missingAiSettings } from '../config.js';
import { REPLAY_PATH, type ReplaySet, replaySet } from './replay.js';

const config = loadAiConfig();
const spec = instanceSpec(config);
if (!spec || config.AI_PROVIDER === 'fake') {
  const missing = missingAiSettings(config);
  console.error(`Set an AI provider in .env first (AI_PROVIDER, AI_MODEL, AI_API_KEY${missing.length ? `; missing: ${missing.join(', ')}` : ''}).`);
  process.exit(2);
}
const provider = createProvider(spec, config.NODE_ENV);
const assistant = new OfflineAssistant(createEmbedder(config));
const current = replaySet();
const items: ReplaySet['items'] = [];
for (const { question } of current.items) {
  const a = await assistant.ask(provider, demoScenario(), question);
  if (a.refused || !a.text.trim()) {
    console.error(`No usable answer for: ${question}`);
    process.exit(1);
  }
  items.push({ question, answer: a.text.trim(), sources: a.sources, unanswered: a.unanswered });
  console.log(`✓ ${question}`);
}
const next: ReplaySet = {
  ...current,
  recordedWith: `${spec.provider} ${spec.model}`,
  recordedAt: new Date().toISOString(),
  promptVersion: PROMPT_VERSION,
  items,
};
writeFileSync(REPLAY_PATH, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Saved ${items.length} answers to apps/api/demo/replay.json. Review them, then commit the file.`);
