import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sourceRefSchema } from '@frontdesk/shared';
import { z } from 'zod';

/** apps/api/demo/replay.json: the public demo's recorded answers (zero AI cost to the host). */
export const REPLAY_PATH = fileURLToPath(new URL('../../demo/replay.json', import.meta.url));

export const replayItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  sources: z.array(sourceRefSchema),
  unanswered: z.boolean(),
});
export type ReplayItem = z.infer<typeof replayItemSchema>;

export const replaySetSchema = z.object({
  about: z.string(),
  recordedWith: z.string(),
  recordedAt: z.string().nullable(),
  promptVersion: z.string(),
  items: z.array(replayItemSchema).min(1),
});
export type ReplaySet = z.infer<typeof replaySetSchema>;

let cached: ReplaySet | undefined;
export const replaySet = (): ReplaySet => (cached ??= replaySetSchema.parse(JSON.parse(readFileSync(REPLAY_PATH, 'utf8'))));

const norm = (s: string) => s.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');

/** Only an exact pick from the suggestions gets an answer: the demo never pretends to answer free text. */
export const findReplay = (question: string): ReplayItem | undefined => replaySet().items.find((i) => norm(i.question) === norm(question));
