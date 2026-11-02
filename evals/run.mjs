#!/usr/bin/env node
// Runs the evaluation set against the same prompts, retrieval and providers the app uses, with YOUR provider:
// set AI_PROVIDER, AI_MODEL and AI_API_KEY (and AI_BASE_URL for an OpenAI-compatible endpoint such as Ollama) in .env.
//
//   pnpm eval            all cases, against the provider in .env (your key, your cost)
//   pnpm eval --small    the small subset
//   pnpm eval --dry      no API calls: checks the set and the prompts build (fake model, fake embeddings). What CI runs.
//
// Writes evals/results/latest.json (the README's score comes from there). Needs the API built (pnpm build).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);
const dist = `${root}apps/api/dist`;
if (!existsSync(`${dist}/ai/offline.js`)) {
  console.error('Build the API first: pnpm build');
  process.exit(2);
}

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const small = args.has('--small');

const { PROMPT_VERSION } = await import(`${dist}/ai/prompts.js`);
const { createEmbedder, FakeEmbedder } = await import(`${dist}/ai/embeddings.js`);
const { demoScenario, OfflineAssistant } = await import(`${dist}/ai/offline.js`);
const { createProvider, instanceSpec } = await import(`${dist}/ai/providers.js`);
const { loadAiConfig, missingAiSettings } = await import(`${dist}/config.js`);

process.env.MODEL_CACHE_DIR ??= `${root}apps/api/storage/models`;
const config = dry ? null : loadAiConfig({ ...process.env, NODE_ENV: 'development' });
let provider;
let spec = null;
if (dry) {
  const { FakeChatProvider } = await import(`${dist}/ai/fake.provider.js`);
  provider = new FakeChatProvider();
} else {
  spec = instanceSpec(config);
  if (!spec) {
    const missing = missingAiSettings(config);
    console.error(`No AI provider configured. Set AI_PROVIDER, AI_MODEL and AI_API_KEY in .env${missing.length ? ` (missing: ${missing.join(', ')})` : ''}, or run pnpm eval --dry.`);
    process.exit(2);
  }
  provider = createProvider(spec, 'development');
}
const assistant = new OfflineAssistant(dry ? new FakeEmbedder() : createEmbedder(config));

const set = JSON.parse(readFileSync(`${root}evals/cases.json`, 'utf8'));
const scenarios = { clinic: demoScenario(), ...set.scenarios };

const norm = (s) => s.toLowerCase().replace(/[’‘]/g, "'");
const grade = (c, text, unanswered) => {
  const t = norm(text);
  const failures = [];
  for (const group of c.includeAny ?? []) {
    if (!group.some((w) => t.includes(norm(w)))) failures.push(`missing one of: ${group.join(' | ')}`);
  }
  for (const w of c.exclude ?? []) if (t.includes(norm(w))) failures.push(`contains: ${w}`);
  if (c.unanswered === true && !unanswered) failures.push('did not report the question as unanswered');
  if (c.unanswered === false && unanswered) failures.push('reported as unanswered but the answer is in the knowledge');
  return failures;
};

const cases = set.cases.filter((c) => !small || c.small);
const results = [];
for (const c of cases) {
  const s = scenarios[c.scenario ?? 'clinic'];
  let text = '';
  let unanswered = false;
  let error = null;
  try {
    const r = await assistant.ask(provider, s, c.question, c.extraKnowledge);
    text = r.text;
    unanswered = r.unanswered;
  } catch (err) {
    // The name only: a provider's error text can echo request details.
    error = err instanceof Error ? `${err.name}${typeof err.status === 'number' ? ` (HTTP ${err.status})` : ''}` : 'error';
  }
  const failures = error ? [`error: ${error}`] : grade(c, text, unanswered);
  results.push({ id: c.id, kind: c.kind, pass: failures.length === 0, failures, answer: text, unanswered });
  console.log(`${failures.length ? 'FAIL' : 'PASS'}  ${c.kind.padEnd(18)} ${c.id}${failures.length ? `\n      ${failures.join('\n      ')}` : ''}`);
}

const passed = results.filter((r) => r.pass).length;
const byKind = {};
for (const r of results) {
  byKind[r.kind] ??= { passed: 0, total: 0 };
  byKind[r.kind].total++;
  if (r.pass) byKind[r.kind].passed++;
}
console.log(`\nScore: ${passed}/${results.length} (${Math.round((passed / results.length) * 100)}%)${dry ? '  [dry run: fake model, not a real score]' : ''}`);
for (const [k, v] of Object.entries(byKind)) console.log(`  ${k.padEnd(18)} ${v.passed}/${v.total}`);

if (!dry) {
  mkdirSync(`${root}evals/results`, { recursive: true });
  writeFileSync(
    `${root}evals/results/${small ? 'small' : 'latest'}.json`,
    `${JSON.stringify({ date: new Date().toISOString(), promptVersion: PROMPT_VERSION, provider: spec.provider, model: spec.model, embeddings: config.EMBEDDING_PROVIDER, passed, total: results.length, byKind, results }, null, 2)}\n`,
  );
}
// CI (--small) fails if anything in the small set fails. Dry runs only check that everything builds and runs.
process.exit(!dry && small && passed < results.length ? 1 : 0);
