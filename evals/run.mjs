#!/usr/bin/env node
// Runs the evaluation set against the same prompts, retrieval and providers the app uses.
//
//   pnpm eval            all cases, with AI_PROVIDER / EMBEDDING_PROVIDER from .env (costs a little)
//   pnpm eval --small    the small subset (CI, when an API key is available)
//   pnpm eval --dry      no API calls: checks the set and the prompts build (fake model, fake embeddings)
//
// Writes evals/results/latest.json (the README's score comes from there). Needs the API built (pnpm build).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);
const dist = `${root}apps/api/dist`;
if (!existsSync(`${dist}/ai/prompts.js`)) {
  console.error('Build the API first: pnpm build');
  process.exit(2);
}

const { ASSISTANT_TOOLS, PROMPT_VERSION, buildInstructions, buildReference, formatHours } = await import(`${dist}/ai/prompts.js`);
const { createEmbedder, FakeEmbedder } = await import(`${dist}/ai/embeddings.js`);
const { chunkText } = await import(`${dist}/knowledge/chunking.js`);
const { DEMO_BUSINESS, DEMO_FAQS, DEMO_PAGES, DEMO_RULES } = await import(`${dist}/demo/clinic.js`);

const args = new Set(process.argv.slice(2));
const dry = args.has('--dry');
const small = args.has('--small');

const env = (k, d = '') => process.env[k] ?? d;
const config = {
  AI_PROVIDER: env('AI_PROVIDER', 'anthropic'),
  ANTHROPIC_API_KEY: env('ANTHROPIC_API_KEY'),
  ANTHROPIC_MODEL: env('ANTHROPIC_MODEL', 'claude-opus-5-5'),
  ANTHROPIC_EFFORT: env('ANTHROPIC_EFFORT', 'low'),
  ANTHROPIC_FALLBACKS: env('ANTHROPIC_FALLBACKS', 'default'),
  OPENAI_API_KEY: env('OPENAI_API_KEY'),
  OPENAI_CHAT_MODEL: env('OPENAI_CHAT_MODEL', 'gpt-4.1-mini'),
  EMBEDDING_PROVIDER: env('EMBEDDING_PROVIDER', 'local'),
  LOCAL_EMBEDDING_MODEL: env('LOCAL_EMBEDDING_MODEL', 'Xenova/all-MiniLM-L6-v2'),
  OPENAI_EMBEDDING_MODEL: env('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small'),
  MODEL_CACHE_DIR: env('MODEL_CACHE_DIR', `${root}apps/api/storage/models`),
};

let provider;
if (dry) {
  const { FakeChatProvider } = await import(`${dist}/ai/fake.provider.js`);
  provider = new FakeChatProvider();
} else if (config.AI_PROVIDER === 'openai') {
  const { OpenAIProvider } = await import(`${dist}/ai/openai.provider.js`);
  provider = new OpenAIProvider(config);
} else {
  const { AnthropicProvider } = await import(`${dist}/ai/anthropic.provider.js`);
  provider = new AnthropicProvider(config);
}
const embedder = dry ? new FakeEmbedder() : createEmbedder(config);

const set = JSON.parse(readFileSync(`${root}evals/cases.json`, 'utf8'));
const clinic = {
  business: DEMO_BUSINESS,
  preset: 'clinic',
  rules: DEMO_RULES,
  knowledge: [
    ...DEMO_FAQS.map((f) => ({ title: f.question, content: `Question: ${f.question}\nAnswer: ${f.answer}` })),
    ...DEMO_PAGES.map((p) => ({ title: p.title, content: p.content })),
  ],
};
const scenarios = { clinic, ...set.scenarios };

const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const corpusCache = new Map();
/** Same chunking and the same top-5 nearest as the app (the app does this in pgvector). */
const retrieve = async (scenario, extra, question) => {
  const docs = [...scenario.knowledge, ...(extra ?? [])];
  const pieces = docs.flatMap((d) =>
    d.content.startsWith('Question:') ? [{ title: d.title, content: d.content }] : chunkText(`${d.title}\n\n${d.content}`).map((c) => ({ title: d.title, content: c })),
  );
  const key = JSON.stringify(pieces);
  let vectors = corpusCache.get(key);
  if (!vectors) {
    vectors = await embedder.embed(pieces.map((p) => p.content));
    corpusCache.set(key, vectors);
  }
  const [q] = await embedder.embed([question]);
  return pieces
    .map((p, i) => ({ ...p, score: cosine(q, vectors[i]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((p, i) => ({ n: i + 1, title: p.title, content: p.content }));
};

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
  const extracts = await retrieve(s, c.extraKnowledge, c.question);
  const business = { ...s.business, hours: formatHours(s.business.openingHours) };
  let text = '';
  let unanswered = false;
  let error = null;
  try {
    const r = await provider.stream(
      {
        system: buildInstructions({ businessName: s.business.name, preset: s.preset, rules: s.rules }),
        reference: buildReference(business, extracts),
        messages: [{ role: 'user', content: c.question }],
        tools: ASSISTANT_TOOLS,
        maxTokens: 800,
      },
      () => undefined,
    );
    text = r.text;
    unanswered = r.toolCalls.some((t) => t.name === 'report_unanswered');
  } catch (err) {
    error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
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
  const model = config.AI_PROVIDER === 'openai' ? config.OPENAI_CHAT_MODEL : config.ANTHROPIC_MODEL;
  writeFileSync(
    `${root}evals/results/${small ? 'small' : 'latest'}.json`,
    `${JSON.stringify({ date: new Date().toISOString(), promptVersion: PROMPT_VERSION, provider: config.AI_PROVIDER, model, embeddings: config.EMBEDDING_PROVIDER, passed, total: results.length, byKind, results }, null, 2)}\n`,
  );
}
// CI (--small) fails if anything in the small set fails. Dry runs only check that everything builds and runs.
process.exit(!dry && small && passed < results.length ? 1 : 0);
