import { isIP } from 'node:net';

/** The client IP. X-Forwarded-For is trusted only when the direct peer is a proxy on this machine. */
export const clientIp = (remote: string | undefined, forwarded: string | string[] | undefined): string => {
  const peer = (remote ?? '').replace(/^::ffff:/, '');
  const loopback = peer === '127.0.0.1' || peer === '::1';
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = header?.split(',')[0]?.trim();
  if (loopback && first && isIP(first)) return first;
  return peer || 'unknown';
};
