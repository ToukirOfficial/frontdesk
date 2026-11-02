import { z } from 'zod';
import { emailSchema, nameSchema, passwordSchema, tokenSchema } from './common.js';

export const registerBodySchema = z.object({
  workspaceName: z.string().trim().min(2).max(100),
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterBody = z.infer<typeof registerBodySchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

/** After a correct password (or sign-up), a 6-digit code is emailed. The challenge id ties the code to that login. */
export const challengeSchema = z.object({ challengeId: z.uuid(), expiresInSec: z.number().int() });
export type Challenge = z.infer<typeof challengeSchema>;

export const verifyCodeBodySchema = z.object({
  challengeId: z.uuid(),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type VerifyCodeBody = z.infer<typeof verifyCodeBodySchema>;

export const resendCodeBodySchema = z.object({ challengeId: z.uuid() });

export const forgotPasswordBodySchema = z.object({ email: emailSchema });
export const resetPasswordBodySchema = z.object({ token: tokenSchema, password: passwordSchema });
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

export const meSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
});
export type Me = z.infer<typeof meSchema>;
