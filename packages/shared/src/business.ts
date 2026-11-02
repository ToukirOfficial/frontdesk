import { z } from 'zod';
import { instantSchema } from './common.js';

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const dayHoursSchema = z
  .object({ closed: z.boolean(), open: time, close: time })
  .refine((d) => d.closed || d.open < d.close, { message: 'Closing time must be after opening time', path: ['close'] });
export type DayHours = z.infer<typeof dayHoursSchema>;

export const openingHoursSchema = z.object({
  mon: dayHoursSchema,
  tue: dayHoursSchema,
  wed: dayHoursSchema,
  thu: dayHoursSchema,
  fri: dayHoursSchema,
  sat: dayHoursSchema,
  sun: dayHoursSchema,
  /** Bank holidays, seasonal changes and so on. */
  notes: z.string().trim().max(500),
});
export type OpeningHours = z.infer<typeof openingHoursSchema>;

const open = { closed: false, open: '09:00', close: '17:00' };
const shut = { closed: true, open: '09:00', close: '17:00' };
export const DEFAULT_OPENING_HOURS: OpeningHours = {
  mon: open,
  tue: open,
  wed: open,
  thu: open,
  fri: open,
  sat: shut,
  sun: shut,
  notes: '',
};

/** http(s) URL or empty. */
const optionalUrl = z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(500)]);
const optionalEmail = z.union([z.literal(''), z.string().trim().toLowerCase().pipe(z.email().max(254))]);

export const businessProfileSchema = z.object({
  name: z.string().trim().max(120),
  address: z.string().trim().max(500),
  openingHours: openingHoursSchema,
  email: optionalEmail,
  phone: z.string().trim().max(40),
  bookingUrl: optionalUrl,
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

export const PRESETS = ['general', 'law', 'clinic'] as const;
export const presetSchema = z.enum(PRESETS);
export type Preset = z.infer<typeof presetSchema>;

export const assistantSettingsBodySchema = z.object({
  preset: presetSchema,
  /** Plain-English rules, e.g. "Never give legal advice; offer a consultation instead." */
  rules: z.string().trim().max(4000),
});
export type AssistantSettingsBody = z.infer<typeof assistantSettingsBodySchema>;

export const assistantSettingsSchema = assistantSettingsBodySchema.extend({
  slotwise: z.object({ connected: z.boolean(), baseUrl: z.string().nullable() }),
});
export type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

/** The API key is write-only: it is encrypted at rest and never returned. */
export const slotwiseBodySchema = z.object({
  baseUrl: z.url({ protocol: /^https?$/ }).max(300),
  apiKey: z
    .string()
    .trim()
    .regex(/^sw_live_[A-Za-z0-9]+_[A-Za-z0-9_-]+$/, 'Paste the full key, starting sw_live_')
    .max(300),
});
export type SlotwiseBody = z.infer<typeof slotwiseBodySchema>;

export const updatedAtSchema = z.object({ updatedAt: instantSchema });
