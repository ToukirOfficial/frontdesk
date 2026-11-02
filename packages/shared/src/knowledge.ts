import { z } from 'zod';
import { instantSchema } from './common.js';

export const SOURCE_TYPES = ['faq', 'text', 'file', 'url'] as const;
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export type SourceType = z.infer<typeof sourceTypeSchema>;
export const sourceStatusSchema = z.enum(['processing', 'ready', 'failed']);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_PAGES = 25;

export const sourceParamsSchema = z.object({ workspaceId: z.uuid(), sourceId: z.uuid() });

export const knowledgeSourceSchema = z.object({
  id: z.uuid(),
  type: sourceTypeSchema,
  title: z.string(),
  question: z.string().nullable(),
  content: z.string().nullable(),
  url: z.string().nullable(),
  fileName: z.string().nullable(),
  sizeBytes: z.number().int().nullable(),
  status: sourceStatusSchema,
  error: z.string().nullable(),
  chunkCount: z.number().int(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
});
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export const knowledgeListSchema = z.object({ items: z.array(knowledgeSourceSchema) });
export type KnowledgeList = z.infer<typeof knowledgeListSchema>;

const faq = z.object({
  type: z.literal('faq'),
  question: z.string().trim().min(3).max(500),
  answer: z.string().trim().min(1).max(5000),
});
const text = z.object({
  type: z.literal('text'),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(100_000),
});
/** FAQ pairs and text pages are created as JSON. Files and websites have their own endpoints. */
export const createKnowledgeBodySchema = z.discriminatedUnion('type', [faq, text]);
export type CreateKnowledgeBody = z.infer<typeof createKnowledgeBodySchema>;

export const updateKnowledgeBodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  question: z.string().trim().min(3).max(500).optional(),
  answer: z.string().trim().min(1).max(5000).optional(),
  content: z.string().trim().min(1).max(100_000).optional(),
});
export type UpdateKnowledgeBody = z.infer<typeof updateKnowledgeBodySchema>;

export const importUrlBodySchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(500),
  maxPages: z.coerce.number().int().min(1).max(MAX_IMPORT_PAGES).default(10),
});
export type ImportUrlBody = z.infer<typeof importUrlBodySchema>;
