import { z } from 'zod';
import { aiSourceSchema } from './ai.js';
import { instantSchema } from './common.js';
import { enquirySchema } from './handover.js';

export const conversationListQuerySchema = z.object({
  cursor: z.uuid().optional(),
  /** Search message text in this workspace. */
  q: z.string().trim().max(200).optional(),
});

export const pageQuerySchema = z.object({ cursor: z.uuid().optional() });

export const enquiryListSchema = z.object({ items: z.array(enquirySchema), nextCursor: z.string().nullable() });
export type EnquiryList = z.infer<typeof enquiryListSchema>;

export const unansweredSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid().nullable(),
  question: z.string(),
  resolvedAt: instantSchema.nullable(),
  createdAt: instantSchema,
});
export type Unanswered = z.infer<typeof unansweredSchema>;
export const unansweredListSchema = z.object({ items: z.array(unansweredSchema), nextCursor: z.string().nullable() });
export type UnansweredList = z.infer<typeof unansweredListSchema>;
export const unansweredQuerySchema = z.object({
  cursor: z.uuid().optional(),
  status: z.enum(['open', 'resolved']).default('open'),
});
export const unansweredParamsSchema = z.object({ workspaceId: z.uuid(), questionId: z.uuid() });
export const resolveBodySchema = z.object({ resolved: z.boolean() });
/** Answer an unanswered question: adds an FAQ to the knowledge and marks the question resolved. */
export const answerBodySchema = z.object({ answer: z.string().trim().min(1).max(5000) });

export const usageSchema = z.object({
  month: z.string(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  monthlyTokenCap: z.number().int(),
  /** chat, or message once the cap is reached. */
  mode: z.enum(['chat', 'message']),
  conversations: z.number().int(),
  enquiries: z.number().int(),
  openUnanswered: z.number().int(),
  retentionDays: z.number().int(),
  /** Who answers: the workspace's own key, the server's key, nobody yet (setup card), or the demo. */
  ai: aiSourceSchema,
});
export type Usage = z.infer<typeof usageSchema>;

export const limitsBodySchema = z.object({
  monthlyTokenCap: z.number().int().min(0).max(1_000_000_000),
  retentionDays: z.number().int().min(1).max(3650),
});
export type LimitsBody = z.infer<typeof limitsBodySchema>;
