import { z } from 'zod';

/** Every error response has this shape; `errorCode` is stable and machine-readable. */
export const errorBodySchema = z.object({
  statusCode: z.number().int(),
  errorCode: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
export type ErrorBody = z.infer<typeof errorBodySchema>;

export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  BAD_ORIGIN: 'BAD_ORIGIN',
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  CONFLICT: 'CONFLICT',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  CODE_INVALID: 'CODE_INVALID',
  CODE_EXPIRED: 'CODE_EXPIRED',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  TOKEN_INVALID: 'TOKEN_INVALID',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  DEMO_MODE: 'DEMO_MODE',
  FILE_REJECTED: 'FILE_REJECTED',
  URL_REJECTED: 'URL_REJECTED',
  NOT_EDITABLE: 'NOT_EDITABLE',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Emails are compared lower-case; the API lower-cases every email it receives. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(200, 'Use at most 200 characters');
export const tokenSchema = z
  .string()
  .min(20)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/);
export const nameSchema = z.string().trim().min(1).max(100);

/** An instant in a response: always a UTC ISO-8601 string (services call toISOString()). */
export const instantSchema = z.iso.datetime();

export const okSchema = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof okSchema>;
