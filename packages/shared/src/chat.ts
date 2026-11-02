import { z } from 'zod';
import { instantSchema } from './common.js';

/** A site allowed to load the widget, normalised to its origin (https://www.example.co.uk). */
const originSchema = z
  .url({ protocol: /^https?$/ })
  .max(200)
  .transform((u) => new URL(u).origin);

export const widgetSettingsBodySchema = z.object({
  greeting: z.string().trim().min(1).max(300),
  brandColour: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0f766e'),
  position: z.enum(['left', 'right']),
  allowedOrigins: z.array(originSchema).max(20),
});
export type WidgetSettingsBody = z.infer<typeof widgetSettingsBodySchema>;

export const widgetSettingsSchema = z.object({
  publicKey: z.string(),
  greeting: z.string(),
  brandColour: z.string(),
  position: z.enum(['left', 'right']),
  allowedOrigins: z.array(z.string()),
  hasAvatar: z.boolean(),
});
export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;

export const MAX_AVATAR_BYTES = 256 * 1024;

export const publicKeyParamsSchema = z.object({ publicKey: z.string().regex(/^fd_pk_[a-f0-9]{32}$/) });

/** What the widget needs to draw itself. Public. */
export const widgetConfigSchema = z.object({
  name: z.string(),
  greeting: z.string(),
  brandColour: z.string(),
  position: z.enum(['left', 'right']),
  avatarUrl: z.string().nullable(),
  /** chat: the assistant answers. message: leave-a-message only (e.g. the monthly cap is reached). */
  mode: z.enum(['chat', 'message']),
  /** slotwise: book inside the chat. link: open the booking link. none: no booking. */
  booking: z.enum(['slotwise', 'link', 'none']),
  bookingUrl: z.string().nullable(),
  consentText: z.string(),
});
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

export const messageRoleSchema = z.enum(['visitor', 'assistant', 'staff', 'system']);
export const sourceRefSchema = z.object({ title: z.string(), url: z.string().nullable() });
export type SourceRef = z.infer<typeof sourceRefSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  authorName: z.string().nullable(),
  sources: z.array(sourceRefSchema),
  createdAt: instantSchema,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const widgetSessionBodySchema = z.object({ token: z.string().max(2000).optional() });
export const widgetSessionSchema = z.object({
  token: z.string(),
  conversationId: z.uuid(),
  messages: z.array(chatMessageSchema),
});
export type WidgetSession = z.infer<typeof widgetSessionSchema>;

export const MAX_VISITOR_MESSAGE = 2000;
export const visitorMessageSchema = z.object({ text: z.string().trim().min(1).max(MAX_VISITOR_MESSAGE) });

/** Socket events from the server to a visitor. */
export interface VisitorServerEvents {
  message: (m: ChatMessage) => void;
  'reply:start': (e: { id: string }) => void;
  'reply:delta': (e: { id: string; text: string }) => void;
  'reply:end': (m: ChatMessage) => void;
  'reply:error': (e: { message: string }) => void;
  /** A person has joined or left; the widget shows who it's talking to. */
  mode: (e: { mode: 'ai' | 'human' | 'closed'; staffName: string | null }) => void;
  /** Nobody is available: the widget opens the leave-a-message form. */
  'handover:unavailable': () => void;
}
export type Ack = (res: { ok: true } | { ok: false; error: string }) => void;
