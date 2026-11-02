import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DAYS, type Day, type OpeningHours, type Preset } from '@frontdesk/shared';

/** Prompts live in versioned files (apps/api/prompts), so the evaluation set tests exactly what the app uses. */
export const PROMPT_VERSION = 'v1';

const dir = fileURLToPath(new URL('../../prompts/', import.meta.url));
const read = (name: string) => readFileSync(`${dir}${name}`, 'utf8');

const BASE = read(`assistant.${PROMPT_VERSION}.md`);
const PRESETS: Record<Preset, string> = {
  general: read(`presets/general.${PROMPT_VERSION}.md`),
  law: read(`presets/law.${PROMPT_VERSION}.md`),
  clinic: read(`presets/clinic.${PROMPT_VERSION}.md`),
};

/** Text that could close or open our data tags is neutralised, so reference data can't break out of its block. */
export const sanitiseData = (text: string): string => text.replace(/<\s*\/?\s*untrusted_data[^>]*>/gi, '[removed tag]');

const oneLine = (s: string) => sanitiseData(s).replace(/\s+/g, ' ').trim();

const DAY_NAME: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** Opening hours as the assistant reads them: one line per day, then any notes. */
export const formatHours = (hours: OpeningHours | null): string =>
  hours
    ? [
        ...DAYS.map((d) => `${DAY_NAME[d]}: ${hours[d].closed ? 'closed' : `${hours[d].open}–${hours[d].close}`}`),
        ...(hours.notes ? [`Notes: ${hours.notes}`] : []),
      ].join('\n')
    : 'not given';

export interface PromptBusiness {
  name: string;
  address: string;
  email: string;
  phone: string;
  bookingUrl: string;
  hours: string;
}

export interface PromptExtract {
  n: number;
  title: string;
  content: string;
}

/** The stable part: the same for every message in a workspace until its settings change. */
export const buildInstructions = (opts: { businessName: string; preset: Preset; rules: string }): string =>
  BASE.replace('{{businessName}}', oneLine(opts.businessName) || 'this business')
    .replace('{{preset}}', PRESETS[opts.preset].trim())
    .replace('{{rules}}', sanitiseData(opts.rules.trim()) || '(none)')
    .trim();

/** The per-question part: business details and the knowledge extracts found for this question. */
export const buildReference = (business: PromptBusiness, extracts: PromptExtract[]): string => {
  const details = [
    `Name: ${oneLine(business.name) || 'not given'}`,
    `Address: ${oneLine(business.address) || 'not given'}`,
    `Phone: ${oneLine(business.phone) || 'not given'}`,
    `Email: ${oneLine(business.email) || 'not given'}`,
    `Booking link: ${oneLine(business.bookingUrl) || 'not given'}`,
    `Opening hours (UK time):\n${sanitiseData(business.hours)}`,
  ].join('\n');

  const knowledge = extracts.length
    ? extracts
        .map((e) => `<untrusted_data source="knowledge" n="${e.n}" title="${oneLine(e.title).replace(/"/g, "'")}">\n${sanitiseData(e.content)}\n</untrusted_data>`)
        .join('\n\n')
    : '(No knowledge extracts matched this question.)';

  return `# Reference data\n\n<untrusted_data source="business_details">\n${details}\n</untrusted_data>\n\n${knowledge}`;
};

/** Tools the model uses to signal things in a structured way (never inferred from the answer's wording). */
export const ASSISTANT_TOOLS = [
  {
    name: 'report_unanswered',
    description:
      'Call this when the reference data does not contain the answer to the visitor’s question (fully or partly). Records the question so the business can add the missing information.',
    inputSchema: {
      type: 'object',
      properties: { question: { type: 'string', description: 'The visitor’s question, in their words.' } },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'cite_sources',
    description: 'Call this with the numbers (n) of the knowledge extracts your answer used.',
    inputSchema: {
      type: 'object',
      properties: { sources: { type: 'array', items: { type: 'integer' }, description: 'Extract numbers, e.g. [1, 3].' } },
      required: ['sources'],
      additionalProperties: false,
    },
  },
];
