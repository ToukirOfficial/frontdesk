import type { AppConfig } from '../config.js';

export type MailTemplate =
  | { kind: 'login_code'; code: string }
  | { kind: 'password_reset'; token: string }
  | { kind: 'invite'; token: string; workspaceName: string; role: string };

/** Plain-text emails in UK English. */
export const render = (t: MailTemplate, config: AppConfig): { subject: string; text: string } => {
  switch (t.kind) {
    case 'login_code':
      return {
        subject: `Your Frontdesk login code: ${t.code}`,
        text: [
          `Your Frontdesk login code is ${t.code}`,
          '',
          'It works once and expires in 10 minutes.',
          'If you didn’t try to log in, change your password: someone may know it.',
        ].join('\n'),
      };
    case 'password_reset':
      return {
        subject: 'Reset your Frontdesk password',
        text: [
          'Someone asked to reset the password for this Frontdesk account.',
          '',
          `Choose a new password: ${config.WEB_URL}/reset-password?token=${t.token}`,
          '',
          'The link works once and expires in 1 hour. If it wasn’t you, ignore this email.',
        ].join('\n'),
      };
    case 'invite':
      return {
        subject: `You’re invited to ${t.workspaceName} on Frontdesk`,
        text: [
          `You’ve been invited to join ${t.workspaceName} on Frontdesk as ${t.role === 'admin' ? 'an admin' : 'staff'}.`,
          '',
          `Accept the invite: ${config.WEB_URL}/invite/${t.token}`,
          '',
          'The link expires in 7 days.',
        ].join('\n'),
      };
  }
};
